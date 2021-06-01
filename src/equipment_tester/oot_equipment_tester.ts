import { IPlugin, IModLoaderAPI, ModLoaderEvents } from 'modloader64_api/IModLoaderAPI';
import { IOOTCore, OotEvents, Age } from 'modloader64_api/OOT/OOTAPI';
import { InjectCore } from 'modloader64_api/CoreInjection';
import { onViUpdate } from 'modloader64_api/PluginLifecycle';
import { EventHandler, bus } from 'modloader64_api/EventHandler';
import { Z64Online_EquipmentPak, Z64OnlineEvents } from './Z64API/OotoAPI';
import { readJSONSync, readFileSync, writeFileSync } from 'fs-extra';
import { join, dirname, basename } from 'path';

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
        "Deku Stick"
    ];
    aliasTable!: Record<string, Record<string, string>>;
    errorTxt = [""];
    form: Form = Form.ADULT;
    game = "";

    preinit(): void {
    }
    init(): void {
        this.aliasTable = readJSONSync(join(__dirname, 'table_offsets.json'));

        this.game = (this.ModLoader.isModLoaded("OoTOnline")) ? "OOT" : "MM";
    }
    postinit(): void {
    }
    onTick(frame?: number | undefined): void {
    }

    @EventHandler(OotEvents.ON_SAVE_LOADED)
    onSaveLoaded(): void {
        this.form = (this.core.save.age === Age.ADULT) ? Form.ADULT : Form.CHILD;
    }

    loadEquipmentZobj(file: string, name?: string, category?: string): Buffer {

        let buf: Buffer;

        try {
            buf = readFileSync(file);
        } catch (error) {
            this.ModLoader.logger.error(error.message);
            this.errorTxt[0] = "Error reading equipment zobj";
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

                if (i !== -1) {

                    /* Biggoron sword, bow, etc fix */
                    /* Remove manifest entry after it's been found */
                    Buffer.alloc(key.length).copy(buf, i);

                    // @ts-ignore: ignore "string cannot be used to index this type"
                    manifest[this.game][manifestForm][manifestIdx.toString()] = this.aliasTable[manifestForm][key];

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
            let nameBuf = Buffer.alloc(0x10 + 0x10 * (name.length / 0x10 + 1));
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

            this.errorTxt[0] = "";

            return finalBuf;
        } catch (error) {
            this.ModLoader.logger.error(error.message);
            return Buffer.alloc(1);
        }
    }

    @EventHandler(OotEvents.ON_AGE_CHANGE)
    onAgeChange(age: Age): void {
        this.form = (age === Age.ADULT) ? Form.ADULT : Form.CHILD;
    }

    @onViUpdate()
    onViUpdate() {
        if (this.isWindowOpen[0]) {
            this.ModLoader.ImGui.begin("Equipment zobj Loader##EquipmentTester", this.isWindowOpen);

            this.ModLoader.ImGui.inputText("zobj##EquipmentTester", this.filepathBox);

            if (this.ModLoader.ImGui.button("Load Equipment##EquipmentTester")) {
                this.ModLoader.utils.setTimeoutFrames(() => {
                    let equip = this.loadEquipmentZobj(join(this.filepathBox[0]));
                    if (equip.byteLength > 1) {
                        bus.emit(Z64OnlineEvents.LOAD_EQUIPMENT_BUFFER, new Z64Online_EquipmentPak(this.filepathBox[0], equip));
                        bus.emit(Z64OnlineEvents.REFRESH_EQUIPMENT);
                        this.ModLoader.logger.debug("Equipment pak loaded!");
                    }
                }, 1);
            }

            if (this.ModLoader.ImGui.button("Clear Equipment##EquipmentTester")) {
                this.ModLoader.utils.setTimeoutFrames(() => {
                    bus.emit(Z64OnlineEvents.CLEAR_EQUIPMENT);
                    bus.emit(Z64OnlineEvents.REFRESH_EQUIPMENT);
                }, 1)
            }

            this.ModLoader.ImGui.inputText("Name##EquipmentTester", this.nameBox);

            this.ModLoader.ImGui.listBox("Category##EquipmentTester", this.currentCat, this.categories);

            if (this.ModLoader.ImGui.button("Save Equipment Zobj##EquipmentTester")) {
                this.ModLoader.utils.setTimeoutFrames(() => {

                    let name = this.nameBox[0];
                    if (name.length >= 0x30) {
                        this.ModLoader.logger.error("Equipment name too long");
                    }
                    else if (name.length === 0) {
                        name = "";
                    }

                    let zobjPath = this.filepathBox[0];

                    let buf = this.loadEquipmentZobj(join(zobjPath, name, this.categories[this.currentCat[0]]));

                    if (buf.byteLength > 1) {
                        try {
                            writeFileSync(join(dirname(zobjPath), (basename(zobjPath, '.zobj') + '_converted.zobj')), buf);
                            this.ModLoader.logger.debug("Saved equipment zobj!");
                            this.errorTxt[0] = "";
                        } catch (error) {
                            this.ModLoader.logger.error(error.message);
                        }
                    }
                }, 1);
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