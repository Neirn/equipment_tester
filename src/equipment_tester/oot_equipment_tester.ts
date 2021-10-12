import { IPlugin, IModLoaderAPI, ModLoaderEvents } from 'modloader64_api/IModLoaderAPI';
import { IOOTCore, OotEvents, Age } from 'modloader64_api/OOT/OOTAPI';
import { InjectCore } from 'modloader64_api/CoreInjection';
import { onViUpdate } from 'modloader64_api/PluginLifecycle';
import { EventHandler, bus } from 'modloader64_api/EventHandler';
import { Z64Online_EquipmentPak, Z64OnlineEvents } from './Z64API/OotoAPI';
import { readJSONSync, readFileSync, writeFileSync } from 'fs-extra';
import { join, basename, resolve } from 'path';
import { optimize } from './zzoptimize';

const enum Form {
    ADULT = "adult",
    CHILD = "child",
    DEKU = "deku",
    ZORA = "zora",
    GORON = "goron",
    FD = "fd"
}

interface IEquipmentManifest {
    "OOT": {
        "adult": Record<string, string>,
        "child": Record<string, string>
    },
    "MM": {
        "human": Record<string, string>,
        "deku": Record<string, string>,
        "zora": Record<string, string>,
        "goron": Record<string, string>,
        "fd": Record<string, string>
    }
}

interface IEquipmentEntry {
    "internal_name": string,
    "display_name": string
    "offset": number;
    "enabled": boolean;
}

const MAX_NAME_SIZE = 0x20;

class oot_equipment_tester implements IPlugin {

    ModLoader!: IModLoaderAPI;
    pluginName?: string | undefined;
    @InjectCore()
    core!: IOOTCore;
    isWindowOpen = [false];
    filepathBox = [""];
    nameBox = [""];
    currentCat = [0];
    categories = [
        "Kokiri Sword",
        "Master Sword",
        "Biggoron Sword",
        "Deku Shield",
        "Hylian Shield",
        "Mirror Shield",
        "Slingshot",
        "Bow",
        "Ocarina of Time",
        "Fairy Ocarina",
        "Hookshot",
        "Boomerang",
        "Deku Stick",
        "Megaton Hammer"
    ];
    nameMap!: Record<string, Record<string, string>>;
    loadedEntries: IEquipmentEntry[] = [];
    aliasTable!: Record<string, Record<string, string>>;
    form: Form = Form.ADULT;
    game = "";
    zobj!: Buffer;
    manifestToOffset!: Map<string, number>;
    isZobjLoaded = false;

    preinit(): void {
    }
    init(): void {
        this.aliasTable = readJSONSync(join(__dirname, 'LUT_to_zzmanifest_map.json'));

        this.game = (this.ModLoader.isModLoaded("OoTOnline")) ? "OOT" : "MM";

        this.nameMap = readJSONSync(join(__dirname, "internal_name_to_readable_name.json"));
    }
    postinit(): void {
    }
    onTick(frame?: number | undefined): void {
    }

    private parseManifest() {

        let manifestOffset = this.zobj.indexOf("!PlayAsManifest");

        if (manifestOffset == -1) {
            throw new Error("Playas manifest not found in zobj!");
        }

        let numDisplayLists = this.zobj.readUInt16BE(manifestOffset + 0x10);

        let currentOffset = manifestOffset + 0x12;

        this.manifestToOffset = new Map();

        while (numDisplayLists > 0) {
            let start = currentOffset;
            while (this.zobj[currentOffset] !== 0 && currentOffset < this.zobj.length) {
                currentOffset++;
            }

            this.manifestToOffset.set(this.zobj.toString('utf8', start, currentOffset), this.zobj.readUInt32BE(currentOffset + 1));

            numDisplayLists--;
            currentOffset += 5;
        }
    }

    loadZobj(zobjPath: string) {

        let zobj: Buffer;

        try {
            zobj = readFileSync(zobjPath);
        } catch (error: any) {
            this.ModLoader.logger.error(error.message);
            return false;
        }

        this.zobj = zobj;

        this.parseManifest();

        this.loadedEntries = [];

        this.manifestToOffset.forEach((offset, name) => {
            if (this.aliasTable[this.form][name]) {
                this.loadedEntries.push({
                    internal_name: name,
                    display_name: this.nameMap[this.form][name],
                    offset: offset,
                    enabled: false
                });
            }
        });

        if (this.loadedEntries.length === 0) {
            this.ModLoader.logger.error("Error parsing playas manifest! No display lists found!");
            return false;
        }
        return true;
    }

    generateZobj(name = "", category = "", removeDupes = false) {
        let enabledEntries: IEquipmentEntry[] = [];
        let offsets: number[] = [];
        this.loadedEntries.forEach((entry) => {
            if (entry.enabled) {
                enabledEntries.push(entry);
                offsets.push(entry.offset);
            }
        });

        let optimized = optimize(this.zobj, offsets, 0, 6, removeDupes)

        try {
            let equipment_header = Buffer.alloc(0x10);
            equipment_header.write("EQUIPMANIFEST");
            let ml64_header = Buffer.alloc(0x10);
            ml64_header.write("MODLOADER64i");
            let manifest: IEquipmentManifest = {
                "OOT": {
                    "adult": {},
                    "child": {}
                },
                "MM": {
                    "human": {},
                    "deku": {},
                    "zora": {},
                    "goron": {},
                    "fd": {}
                }
            };

            let manifestForm: Form = this.form;
            let DECommands: Array<Buffer> = new Array();

            enabledEntries.forEach((entry) => {
                let de = Buffer.alloc(0x8);
                de.writeUInt32BE(0xDE010000, 0);
                de.writeUInt32BE(optimized.oldOffs2NewOffs.get(entry.offset)!, 4);
                de[4] = 0x06;
                manifest["OOT"][manifestForm][DECommands.length] = this.aliasTable[manifestForm][entry.internal_name];
                DECommands.push(de);
            });

            // this.ModLoader.logger.debug(JSON.stringify(manifest));

            ml64_header.writeUInt32BE(DECommands.length, 0x0C);

            let finalBuf = Buffer.concat([ml64_header, Buffer.concat(DECommands)]);
            if (finalBuf.byteLength % 0x10 !== 0) {
                finalBuf = Buffer.concat([finalBuf, Buffer.alloc(8)]);
            }
            finalBuf = Buffer.concat([finalBuf, equipment_header, Buffer.from(JSON.stringify(manifest)), Buffer.from([0xFF])]);
            let padding = finalBuf.byteLength % 0x10;
            if (padding !== 0) {
                finalBuf = Buffer.concat([finalBuf, Buffer.alloc(0x10 - padding)]);
            }

            let nameBuf = Buffer.alloc(0x10 + 0x10 * (Math.floor(name.length / 0x10) + 1));
            nameBuf.write("EQUIPMENTNAME");
            nameBuf.write(name, 0x10);

            let catBuf = Buffer.alloc(0x20);
            catBuf.write("EQUIPMENTCAT");
            if (category) {
                catBuf.write(category, 0x10);
            }
            finalBuf = Buffer.concat([optimized.zobj, finalBuf, nameBuf, catBuf]);

            return finalBuf;
        } catch (error: any) {
            this.ModLoader.logger.error("Error creating equipment zobj")
            this.ModLoader.logger.error(error.message);
            return Buffer.alloc(1);
        }

    }

    loadEquipmentZobj(file: string, name?: string, category?: string): Buffer {

        let buf: Buffer;

        try {
            buf = readFileSync(file);
        } catch (error: any) {
            this.ModLoader.logger.error(error.message);
            this.ModLoader.logger.error("Error reading equipment zobj");
            return Buffer.alloc(1);
        }

        try {
            let equipment_header = Buffer.alloc(0x10);
            equipment_header.write("EQUIPMANIFEST");
            let ml64_header = Buffer.alloc(0x10);
            ml64_header.write("MODLOADER64i");
            let manifest: IEquipmentManifest = {
                "OOT": {
                    "adult": {},
                    "child": {}
                },
                "MM": {
                    "human": {},
                    "deku": {},
                    "zora": {},
                    "goron": {},
                    "fd": {}
                }
            };
            let manifestForm: Form = this.form;
            let DECommands: Array<Buffer> = new Array();

            let manifestIdx = 0;

            for (const key in this.aliasTable[manifestForm]) {
                let i = buf.indexOf(key);

                if (i !== -1 && buf[i + key.length + 1] === 0) {

                    // @ts-ignore: ignore "string cannot be used to index this type"
                    manifest["OOT"][manifestForm][manifestIdx.toString()] = this.aliasTable[manifestForm][key];

                    let de = Buffer.alloc(0x8);
                    de.writeUInt32BE(0xDE010000, 0);
                    de.writeUInt32BE(buf.readUInt32BE(i + key.length + 1), 4);
                    de[4] = 0x06;

                    DECommands.push(de);

                    manifestIdx++;
                }
            }

            // this.ModLoader.logger.debug(JSON.stringify(manifest));

            ml64_header.writeUInt32BE(DECommands.length, 0x0C);

            let finalBuf = Buffer.concat([ml64_header, Buffer.concat(DECommands)]);
            if (finalBuf.byteLength % 0x10 !== 0) {
                finalBuf = Buffer.concat([finalBuf, Buffer.alloc(8)]);
            }
            finalBuf = Buffer.concat([finalBuf, equipment_header, Buffer.from(JSON.stringify(manifest)), Buffer.from([0xFF])]);
            let padding = finalBuf.byteLength % 0x10;
            if (padding !== 0) {
                finalBuf = Buffer.concat([finalBuf, Buffer.alloc(0x10 - padding)]);
            }

            if (!name)
                name = "";
            let nameBuf = Buffer.alloc(0x10 + 0x10 * (Math.floor(name.length / 0x10) + 1));
            nameBuf.write("EQUIPMENTNAME");
            if (name) {
                nameBuf.write(name, 0x10);
            }
            let catBuf = Buffer.alloc(0x20);
            catBuf.write("EQUIPMENTCAT");
            if (category) {
                catBuf.write(category, 0x10);
            }

            let off = buf.indexOf("!PlayAsManifest");
            finalBuf = Buffer.concat([buf.slice(0, (off !== -1) ? off : buf.length), finalBuf, nameBuf, catBuf]);

            return finalBuf;
        } catch (error: any) {
            this.ModLoader.logger.error("Error creating equipment zobj")
            this.ModLoader.logger.error(error.message);
            return Buffer.alloc(1);
        }
    }

    @EventHandler(OotEvents.ON_AGE_CHANGE)
    onAgeChange(age: Age): void {
        this.form = (age === Age.ADULT) ? Form.ADULT : Form.CHILD;
    }

    @EventHandler(OotEvents.ON_SAVE_LOADED)
    onSaveLoad() {
        let age = this.core.save.age;
        this.form = (age === Age.ADULT) ? Form.ADULT : Form.CHILD;
    }

    @onViUpdate()
    onViUpdate() {
        if (this.isWindowOpen[0]) {
            this.ModLoader.ImGui.begin("Equipment zobj Loader##EquipmentTester", this.isWindowOpen);

            this.ModLoader.ImGui.inputText("zobj##EquipmentTester", this.filepathBox);

            if (this.ModLoader.ImGui.button("Load zobj##EquipmentTester")) {
                this.ModLoader.utils.setTimeoutFrames(() => {
                    this.isZobjLoaded = this.loadZobj(join(this.filepathBox[0].replace(new RegExp("\"", 'g'), '')));
                    if (this.isZobjLoaded) {
                        this.ModLoader.logger.info("zobj successfully loaded!");
                    }
                }, 1);
            }

            if (this.ModLoader.ImGui.button("Clear Equipment##EquipmentTester")) {
                this.ModLoader.utils.setTimeoutFrames(() => {
                    bus.emit(Z64OnlineEvents.CLEAR_EQUIPMENT);
                    bus.emit(Z64OnlineEvents.REFRESH_EQUIPMENT);
                }, 1)
            }

            if (this.isZobjLoaded) {
                this.ModLoader.ImGui.inputText("Name##EquipmentTester", this.nameBox);

                this.ModLoader.ImGui.listBox("Category##EquipmentTester", this.currentCat, this.categories);

                
                if (this.ModLoader.ImGui.treeNode("Loaded Display Lists##EquipmentTester")) {
                    if (this.ModLoader.ImGui.menuItem("Uncheck All##EquipementTester")) {
                        this.ModLoader.utils.setTimeoutFrames(() => {
                            this.loadedEntries.forEach((entry) => {
                                entry.enabled = false;
                            });
                        }, 1);
                    }
                    this.loadedEntries.forEach((entry) => {
                        if (this.ModLoader.ImGui.menuItem(entry.display_name, undefined, entry.enabled)) {
                            entry.enabled = !entry.enabled;
                        }
                    });
                    this.ModLoader.ImGui.treePop();
                }


                if (this.ModLoader.ImGui.button("Test Equipment##EquipmentTester")) {
                    this.ModLoader.utils.setTimeoutFrames(() => {

                        let buf = this.generateZobj("", this.categories[this.currentCat[0]], true);

                        if (buf.byteLength > 1) {
                            bus.emit(Z64OnlineEvents.LOAD_EQUIPMENT_BUFFER, new Z64Online_EquipmentPak("testerzobj", buf));
                            bus.emit(Z64OnlineEvents.REFRESH_EQUIPMENT);
                        }
                        
                    }, 1);
                }

                if (this.ModLoader.ImGui.button("Save Equipment Zobj##EquipmentTester")) {
                    this.ModLoader.utils.setTimeoutFrames(() => {

                        let name = this.nameBox[0];
                        if (name.length >= MAX_NAME_SIZE) {
                            this.ModLoader.logger.error("Equipment name too long");
                            return;
                        }

                        let buf = this.generateZobj(name, this.categories[this.currentCat[0]], true);

                        if (buf.byteLength > 1) {
                            try {
                                let filename: string;
                                if (this.nameBox[0] === "") {
                                    filename = basename(this.filepathBox[0]);
                                }
                                else {
                                    filename = this.nameBox[0] + '.zobj';
                                }

                                let writePath = resolve('./' + filename);

                                writeFileSync(writePath, buf, "binary");
                                this.ModLoader.logger.debug("Saved equipment zobj to " + writePath);
                            } catch (error: any) {
                                this.ModLoader.logger.error(error.message);
                            }
                        }
                    }, 1);
                }
            }
            // this.ModLoader.ImGui.text(this.errorTxt[0]);

            this.ModLoader.ImGui.end();
        }

        if (this.ModLoader.ImGui.beginMainMenuBar()) {

            if (this.ModLoader.ImGui.beginMenu("Mods")) {
                if (this.ModLoader.ImGui.menuItem("Equipment Tester")) {
                    this.isWindowOpen[0] = true;
                }

                this.ModLoader.ImGui.endMenu();
            }

            this.ModLoader.ImGui.endMainMenuBar();
        }
    }

}

module.exports = oot_equipment_tester;