"""Converts the MakeHuman base human (CC0 assets) into a compact game model for Football Royale.

Inputs (download from https://github.com/makehumancommunity/makehuman, folder makehuman/data):
  3dobjs/base.obj, rigs/default.mhskel, rigs/default_weights.mhw,
  targets/macrodetails/universal-male-young-maxmuscle-averageweight.target
Usage:  python3 tools/build_human.py <folder with those files> client/assets
Writes human.json (skeleton + info) and human.bin (mesh data).
This script is original to Football Royale; it only reads MakeHuman's CC0 data files.
"""
import json, math, struct, sys, os

SRC, OUT = sys.argv[1], sys.argv[2]
HEIGHT = 1.86        # meters
MUSCLE = 0.75        # how much of the "max muscle" body target to apply

KEEP = ['root', 'spine05', 'spine04', 'spine03', 'spine02', 'spine01', 'neck01', 'neck02', 'neck03', 'head']
for s in ('L', 'R'):
    KEEP += [f'{b}.{s}' for b in ('clavicle', 'shoulder01', 'upperarm01', 'upperarm02', 'lowerarm01', 'lowerarm02', 'wrist',
                                   'pelvis', 'upperleg01', 'upperleg02', 'lowerleg01', 'lowerleg02', 'foot')]
ALIGN_DOWN = {f'{b}.{s}' for s in 'LR' for b in ('upperarm01', 'upperarm02', 'lowerarm01', 'lowerarm02', 'wrist',
                                                   'upperleg01', 'upperleg02', 'lowerleg01', 'lowerleg02')}

# ---------- read mesh ----------
V, faces = [], []
group = None
for line in open(os.path.join(SRC, '3dobjs/base.obj')):
    if line.startswith('v '):
        V.append([float(x) for x in line.split()[1:4]])
    elif line.startswith('g '):
        group = line.split()[1]
    elif line.startswith('f '):
        if group == 'body' or 'eyelashes' in group:
            faces.append(([int(t.split('/')[0]) - 1 for t in line.split()[1:]], group))
eye_idx = {'L': set(), 'R': set()}
group = None
for line in open(os.path.join(SRC, '3dobjs/base.obj')):
    if line.startswith('g '):
        group = line.split()[1]
    elif line.startswith('f ') and group in ('helper-l-eye', 'helper-r-eye'):
        eye_idx['L' if group == 'helper-l-eye' else 'R'].update(int(t.split('/')[0]) - 1 for t in line.split()[1:])

# body shape: young adult male (average of three ethnicities, like MakeHuman's default), athletic, ideal proportions
TARGETS = [
    ('macrodetails/caucasian-male-young.target', 1 / 3),
    ('macrodetails/african-male-young.target', 1 / 3),
    ('macrodetails/asian-male-young.target', 1 / 3),
    ('macrodetails/universal-male-young-maxmuscle-averageweight.target', MUSCLE),
    ('macrodetails/proportions/male-young-averagemuscle-averageweight-idealproportions.target', 1.0),
]
for path, wt in TARGETS:
    for line in open(os.path.join(SRC, 'targets', path)):
        if not line.strip() or line[0] == '#':
            continue
        i, dx, dy, dz = line.split()
        i = int(i)
        V[i][0] += float(dx) * wt; V[i][1] += float(dy) * wt; V[i][2] += float(dz) * wt

used = sorted({i for f, _ in faces for i in f})
sk = json.load(open(os.path.join(SRC, 'rigs/default.mhskel')))
joint = {k: [sum(V[i][a] for i in v) / len(v) for a in range(3)] for k, v in sk['joints'].items()}

# ---------- to game space: meters, feet on y=0, facing -z ----------
miny = min(V[i][1] for i in used)
maxy = max(V[i][1] for i in used)
scale = HEIGHT / (maxy - miny)
zc = joint[sk['bones']['root']['head']][2]
def tg(p):
    return [-p[0] * scale, (p[1] - miny) * scale, -(p[2] - zc) * scale]
P = {i: tg(V[i]) for i in used}
J = {k: tg(v) for k, v in joint.items()}
eyes = {}
for s, idx in eye_idx.items():
    pts = [tg(V[i]) for i in idx]
    c = [sum(p[a] for p in pts) / len(pts) for a in range(3)]
    r = max(math.dist(p, c) for p in pts)
    eyes[s] = {'c': c, 'r': r}

# ---------- skeleton ----------
bones = sk['bones']
def kept(name):
    while name not in KEEP:
        name = bones[name]['parent']
    return name
def sub(a, b): return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
def norm(v):
    l = math.sqrt(sum(x * x for x in v)) or 1
    return [x / l for x in v]
def q_from_to(a, b):  # quaternion rotating unit a onto unit b (x,y,z,w)
    d = sum(x * y for x, y in zip(a, b))
    if d < -0.999999:
        return [1, 0, 0, 0]
    c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    q = [c[0], c[1], c[2], 1 + d]
    l = math.sqrt(sum(x * x for x in q))
    return [x / l for x in q]
def q_mul(a, b):
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz]
def q_inv(q): return [-q[0], -q[1], -q[2], q[3]]
def q_rot(q, v):
    p = q_mul(q_mul(q, [v[0], v[1], v[2], 0]), q_inv(q))
    return p[:3]

head = {b: J[bones[b]['head']] for b in KEEP}
tail = {b: J[bones[b]['tail']] for b in KEEP}
qw = {b: (q_from_to([0, -1, 0], norm(sub(tail[b], head[b]))) if b in ALIGN_DOWN else [0, 0, 0, 1]) for b in KEEP}
order = []
def visit(b):
    if b in order: return
    p = bones[b]['parent']
    if p: visit(kept(p))
    order.append(b)
for b in KEEP: visit(b)
bone_out = []
for b in order:
    p = bones[b]['parent']
    p = kept(p) if p else None
    if p:
        inv = q_inv(qw[p])
        pos = q_rot(inv, sub(head[b], head[p]))
        q = q_mul(inv, qw[b])
    else:
        pos, q = head[b], qw[b]
    bone_out.append({'name': b, 'parent': order.index(p) if p else -1, 'pos': [round(x, 5) for x in pos], 'quat': [round(x, 6) for x in q]})
bindex = {b: i for i, b in enumerate(order)}

# ---------- weights ----------
W = json.load(open(os.path.join(SRC, 'rigs/default_weights.mhw')))['weights']
acc = {}
dominant = {}
for bname, lst in W.items():
    k = kept(bname)
    for vi, w in lst:
        d = acc.setdefault(vi, {})
        d[k] = d.get(k, 0) + w
        if w > dominant.get(vi, ('', 0))[1]:
            dominant[vi] = (bname, w)

# ---------- paint the uniform (regions) ----------
SKIN, JERSEY, PANTS, SOCK, SHOE, GLOVE, ACCENT, BROW, LIPS, EYEBLACK, TAPE, LASH = range(12)
hipY = J[bones['upperleg01.L']['head']][1]
kneeY = J[bones['lowerleg01.L']['head']][1]
ankleY = J[bones['foot.L']['head']][1]
waistY = hipY + 0.15
neckY = J[bones['neck01']['head']][1]
eyeY = (eyes['L']['c'][1] + eyes['R']['c'][1]) / 2
eyeZ = (eyes['L']['c'][2] + eyes['R']['c'][2]) / 2
lash_verts = {i for f, g in faces if 'eyelashes' in g for i in f}
region = {}
for i in used:
    x, y, z = P[i]
    b = dominant.get(i, ('root', 0))[0]
    side = 'L' if x < 0 else 'R'
    if i in lash_verts:
        r = LASH
    elif b.startswith(('foot', 'toe')) or y < ankleY + 0.035:
        r = SHOE
    elif b.startswith(('wrist', 'finger', 'metacarpal')):
        r = GLOVE
    elif b.startswith('lowerarm'):
        r = TAPE if math.dist(P[i], J[bones['wrist.' + side]['head']]) < 0.06 else SKIN
    elif b.startswith('upperarm') or b.startswith('shoulder'):
        t = math.dist(P[i], J[bones['upperarm01.' + side]['head']])
        r = JERSEY if (t < 0.16 or b.startswith('shoulder')) else SKIN
    elif b.startswith('lowerleg'):
        r = PANTS if y > kneeY - 0.035 else ACCENT if kneeY - 0.16 < y < kneeY - 0.12 else SOCK
    elif b.startswith(('upperleg', 'pelvis')) and y < hipY - 0.04:
        r = PANTS
    elif b.startswith(('neck', 'head', 'jaw', 'eye', 'oris', 'oculi', 'orbicularis', 'levator', 'risorius', 'temporalis', 'special', 'tongue')):
        r = SKIN
        front = z < eyeZ + 0.035
        for s in ('L', 'R'):
            ex = eyes[s]['c'][0]
            if front and abs(x - ex) < 0.024 and eyeY + 0.017 < y < eyeY + 0.03 and abs(x) > 0.008:
                r = BROW
            if front and abs(x - ex) < 0.02 and eyeY - 0.032 < y < eyeY - 0.019:
                r = EYEBLACK
        if b.startswith('oris') and front and y < eyeY - 0.05:
            r = LIPS
        if y < neckY - 0.01 and not b.startswith('head'):
            r = JERSEY
    else:  # torso and hips: clean bands
        r = JERSEY if y >= waistY - 0.015 else PANTS
    region[i] = r

# ---------- normals ----------
N = {i: [0.0, 0.0, 0.0] for i in used}
tris = []
for f, g in faces:
    for k in range(1, len(f) - 1):
        a, b, c = f[0], f[k], f[k + 1]
        # flipping x and z keeps handedness, so winding stays the same
        tris.append((a, b, c))
        e1, e2 = sub(P[b], P[a]), sub(P[c], P[a])
        n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
        for v in (a, b, c):
            N[v] = [N[v][0] + n[0], N[v][1] + n[1], N[v][2] + n[2]]

# group triangles by material: 0 = skin-like, 1 = cloth, 2 = shoes
def mat_of(r):
    return 2 if r == SHOE else 1 if r in (JERSEY, PANTS, SOCK, GLOVE, ACCENT, TAPE) else 0
remap = {v: n for n, v in enumerate(used)}
groups_out, idx = [], []
for m in (0, 1, 2):
    start = len(idx)
    for t in tris:
        rr = [region[v] for v in t]
        mm = max(mat_of(r) for r in rr) if m != 0 else 0
        tm = mat_of(max(rr, key=lambda r: mat_of(r))) if True else 0
        if tm == m:
            idx += [remap[v] for v in t]
    groups_out.append({'start': start, 'count': len(idx) - start, 'mat': m})

# ---------- write ----------
n = len(used)
buf = bytearray()
def put(fmt, vals):
    global buf
    buf += struct.pack('<' + fmt * len(vals), *vals)
off = {}
off['position'] = len(buf); put('f', [c for i in used for c in P[i]])
off['normal'] = len(buf); put('f', [c for i in used for c in norm(N[i])])
sidx, swt = [], []
for i in used:
    ws = sorted(acc.get(i, {'root': 1}).items(), key=lambda kv: -kv[1])[:4]
    tot = sum(w for _, w in ws) or 1
    q = [round(255 * w / tot) for _, w in ws]
    q[0] += 255 - sum(q)
    while len(ws) < 4: ws.append(('root', 0)); q.append(0)
    sidx += [bindex[b] for b, _ in ws]; swt += q
off['skinIndex'] = len(buf); put('B', sidx)
off['skinWeight'] = len(buf); put('B', swt)
off['region'] = len(buf); put('B', [region[i] for i in used])
while len(buf) % 4: buf.append(0)
off['index'] = len(buf); put('H', idx)

info = {
    'source': 'MakeHuman base mesh hm08, default skeleton and weights (CC0 1.0), converted by tools/build_human.py',
    'vertexCount': n, 'indexCount': len(idx), 'offsets': off, 'groups': groups_out, 'bones': bone_out,
    'meta': {'waistR': [max(abs(P[i][0]) for i in used if abs(P[i][1] - waistY) < 0.01 and region[i] in (JERSEY, PANTS)),
                        max(abs(P[i][2]) for i in used if abs(P[i][1] - waistY) < 0.01 and region[i] in (JERSEY, PANTS) and abs(P[i][0]) < 0.05)],
             'hipY': hipY, 'kneeY': kneeY, 'waistY': waistY, 'neckY': neckY,
             'eyes': eyes, 'headTop': max(P[i][1] for i in used),
             'shoulder': J[bones['upperarm01.R']['head']], 'height': HEIGHT},
}
os.makedirs(OUT, exist_ok=True)
open(os.path.join(OUT, 'human.bin'), 'wb').write(buf)
json.dump(info, open(os.path.join(OUT, 'human.json'), 'w'))
print(f'vertices {n}, triangles {len(idx) // 3}, bones {len(order)}, bin {len(buf) // 1024} KB')
print('groups', groups_out)
print('meta', json.dumps(info['meta'])[:400])
