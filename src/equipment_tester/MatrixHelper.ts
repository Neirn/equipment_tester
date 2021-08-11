function FTOFIX32(x: number) {
    let output: number = ((x) * 65536.0);
    return output;
}

export function guMtxF2L(mf: number[][]): Buffer {
    let e1: number = 0, e2: number = 0;
    let ai: number = 0, af: number = 0;

    let buf: Buffer = Buffer.alloc(0x40);
    let offset: number = 0;
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 2; j++) {
            e1 = FTOFIX32(mf[i][j * 2]);
            e2 = FTOFIX32(mf[i][(j * 2) + 1]);
            ai = (e1 & 0xFFFF0000) | ((e2 >> 16) & 0xFFFF);
            buf.writeInt32BE(ai, offset);
            offset += 0x4;
        }
    }
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 2; j++) {
            e1 = FTOFIX32(mf[i][j * 2]);
            e2 = FTOFIX32(mf[i][(j * 2) + 1]);
            af = ((e1 << 16) & 0xFFFF0000) | (e2 & 0xFFFF);
            buf.writeInt32BE(af, offset);
            offset += 0x4;
        }
    }
    return buf;
}

export function guRTSF(r: number, p: number, h: number, x: number, y: number, z: number, sx: number, sy: number, sz: number): number[][] {
    let sinr: number, sinp: number, sinh: number, cosr: number, cosp: number, cosh: number;
    let mf: number[][] = [[], [], [], []];

    r = r * (Math.PI / 180);
    p = p * (Math.PI / 180);
    h = h * (Math.PI / 180);
    sinr = Math.sin(r);//Sine Roll
    cosr = Math.cos(r);//Cosine Roll
    sinp = Math.sin(p);//Sine Pitch
    cosp = Math.cos(p);//Cosine Pitch
    sinh = Math.sin(h);//Sine Heading
    cosh = Math.cos(h);//Cosine Heading

    mf[0][0] = (cosp * cosh) * sx;
    mf[0][1] = (cosp * sinh) * sx;
    mf[0][2] = (-sinp) * sx;
    mf[0][3] = 0.0;

    mf[1][0] = (sinr * sinp * cosh - cosr * sinh) * sy;
    mf[1][1] = (sinr * sinp * sinh + cosr * cosh) * sy;
    mf[1][2] = (sinr * cosp) * sy;
    mf[1][3] = 0.0;

    mf[2][0] = (cosr * sinp * cosh + sinr * sinh) * sz;
    mf[2][1] = (cosr * sinp * sinh - sinr * cosh) * sz;
    mf[2][2] = (cosr * cosp) * sz;
    mf[2][3] = 0.0;

    mf[3][0] = x;
    mf[3][1] = y;
    mf[3][2] = z;
    mf[3][3] = 1.0;

    return mf;
}
