#!/usr/bin/env python3
"""Rebuild SNIPE's original CC0 GLB models and synthesized PCM audio.

Python 3 standard library only. Run from any directory; outputs are resolved
relative to this file. Geometry uses +Y up, +Z muzzle-forward in the GLB data.
Babylon's glTF handedness conversion must be normalized by the application.
These are fictional visual props, not fabrication geometry.
"""
from __future__ import annotations

import array
import hashlib
import json
import math
import random
import struct
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "assets"
TAU = 2 * math.pi


def quat(axis, radians):
    s = math.sin(radians / 2)
    return [axis[0] * s, axis[1] * s, axis[2] * s, math.cos(radians / 2)]


class GLB:
    def __init__(self, name):
        self.name = name
        self.data = bytearray()
        self.doc = {
            "asset": {"version": "2.0", "generator": "SNIPE original asset generator", "copyright": "CC0-1.0"},
            "scene": 0, "scenes": [{"nodes": [0]}],
            "nodes": [{"name": "root", "children": []}],
            "meshes": [], "materials": [], "buffers": [], "bufferViews": [], "accessors": [],
        }
        self.cache = {}

    def material(self, name, rgb, metal=0, rough=.7, emissive=None):
        m = {"name": name, "pbrMetallicRoughness": {"baseColorFactor": [*rgb, 1], "metallicFactor": metal, "roughnessFactor": rough}, "doubleSided": True}
        if emissive:
            m["emissiveFactor"] = emissive
        self.doc["materials"].append(m)
        return len(self.doc["materials"]) - 1

    def accessor(self, values, width, kind="FLOAT", bounds=False):
        while len(self.data) % 4:
            self.data.append(0)
        offset = len(self.data)
        fmt, component = ("f", 5126) if kind == "FLOAT" else ("H", 5123)
        raw = struct.pack("<" + fmt * len(values), *values)
        self.data.extend(raw)
        self.doc["bufferViews"].append({"buffer": 0, "byteOffset": offset, "byteLength": len(raw)})
        a = {"bufferView": len(self.doc["bufferViews"]) - 1, "componentType": component, "count": len(values) // width, "type": {1: "SCALAR", 2: "VEC2", 3: "VEC3"}[width]}
        if bounds:
            a["min"] = [min(values[j::width]) for j in range(width)]
            a["max"] = [max(values[j::width]) for j in range(width)]
        self.doc["accessors"].append(a)
        return len(self.doc["accessors"]) - 1

    def mesh(self, key, positions, normals, indices, material):
        key = (key, material)
        if key in self.cache:
            return self.cache[key]
        mesh = {"name": str(key[0]), "primitives": [{"attributes": {
            "POSITION": self.accessor(positions, 3, bounds=True),
            "NORMAL": self.accessor(normals, 3),
        }, "indices": self.accessor(indices, 1, "UNSIGNED_SHORT"), "material": material}]}
        self.doc["meshes"].append(mesh)
        index = len(self.doc["meshes"]) - 1
        self.cache[key] = index
        return index

    def node(self, name, pos=(0, 0, 0), size=(1, 1, 1), mesh=None, rotation=None, parent=0):
        n = {"name": name, "translation": list(pos), "scale": list(size)}
        if mesh is not None:
            n["mesh"] = mesh
        if rotation:
            n["rotation"] = rotation
        self.doc["nodes"].append(n)
        i = len(self.doc["nodes"]) - 1
        self.doc["nodes"][parent].setdefault("children", []).append(i)
        return i

    def box(self, name, pos, size, mat, rotation=None, parent=0):
        p, n, ind = [], [], []
        for normal, corners in [
            ((0, 0, 1), [(-.5, -.5, .5), (.5, -.5, .5), (.5, .5, .5), (-.5, .5, .5)]),
            ((0, 0, -1), [(.5, -.5, -.5), (-.5, -.5, -.5), (-.5, .5, -.5), (.5, .5, -.5)]),
            ((1, 0, 0), [(.5, -.5, .5), (.5, -.5, -.5), (.5, .5, -.5), (.5, .5, .5)]),
            ((-1, 0, 0), [(-.5, -.5, -.5), (-.5, -.5, .5), (-.5, .5, .5), (-.5, .5, -.5)]),
            ((0, 1, 0), [(-.5, .5, .5), (.5, .5, .5), (.5, .5, -.5), (-.5, .5, -.5)]),
            ((0, -1, 0), [(-.5, -.5, -.5), (.5, -.5, -.5), (.5, -.5, .5), (-.5, -.5, .5)]),
        ]:
            base = len(p) // 3
            for c in corners:
                p.extend(c); n.extend(normal)
            ind.extend([base, base+1, base+2, base, base+2, base+3])
        return self.node(name, pos, size, self.mesh("box", p, n, ind, mat), rotation, parent)

    def cylinder(self, name, pos, radius, length, mat, axis="z", segments=24, taper=1, parent=0):
        p, n, idx = [], [], []
        slope = (1 - taper)
        for j in range(segments):
            a = j / segments * TAU
            b = (j+1) / segments * TAU
            base = len(p) // 3
            for ang, z, r in [(a, -.5, 1), (b, -.5, 1), (b, .5, taper), (a, .5, taper)]:
                p.extend([math.cos(ang)*r, math.sin(ang)*r, z])
                norm = math.sqrt(1 + slope*slope)
                n.extend([math.cos(ang)/norm, math.sin(ang)/norm, slope/norm])
            idx.extend([base, base+1, base+2, base, base+2, base+3])
            for z, r, sign in [(-.5, 1, -1), (.5, taper, 1)]:
                base = len(p)//3
                verts = [(0,0,z), (math.cos(a)*r,math.sin(a)*r,z), (math.cos(b)*r,math.sin(b)*r,z)]
                for v in verts:
                    p.extend(v); n.extend([0,0,sign])
                idx.extend([base, base+1, base+2] if sign > 0 else [base, base+2, base+1])
        rot = quat((1,0,0), -math.pi/2) if axis == "y" else quat((0,1,0), math.pi/2) if axis == "x" else None
        return self.node(name, pos, (radius,radius,length), self.mesh(f"cylinder-{segments}-{taper}",p,n,idx,mat),rot,parent)

    def profile(self, name, points, depth, mat, parent=0):
        """Extrude a distinctive Y/Z silhouette along X."""
        p, n, ind = [], [], []
        count = len(points)
        for sign in [-1,1]:
            base=len(p)//3
            cy=sum(v[0] for v in points)/count; cz=sum(v[1] for v in points)/count
            p.extend([sign*depth/2,cy,cz]); n.extend([sign,0,0])
            for y,z in points:
                p.extend([sign*depth/2,y,z]); n.extend([sign,0,0])
            for j in range(count):
                tri=[base,base+1+j,base+1+(j+1)%count]
                ind.extend(tri if sign > 0 else tri[::-1])
        for j in range(count):
            y1,z1=points[j]; y2,z2=points[(j+1)%count]
            dy,dz=y2-y1,z2-z1; length=math.hypot(dy,dz)
            norm=[0,-dz/length,dy/length]
            base=len(p)//3
            for v in [(-depth/2,y1,z1),(depth/2,y1,z1),(depth/2,y2,z2),(-depth/2,y2,z2)]:
                p.extend(v); n.extend(norm)
            ind.extend([base,base+1,base+2,base,base+2,base+3])
        return self.node(name,mesh=self.mesh(name,p,n,ind,mat),parent=parent)

    def write(self, filename):
        self.batch_static_parts()
        self.doc["buffers"]=[{"byteLength":len(self.data)}]
        j=json.dumps(self.doc,separators=(",",":"),ensure_ascii=False).encode()
        j+=b" "*((-len(j))%4)
        b=bytes(self.data)+b"\0"*((-len(self.data))%4)
        raw=struct.pack("<4sII",b"glTF",2,12+8+len(j)+8+len(b))+struct.pack("<I4s",len(j),b"JSON")+j+struct.pack("<I4s",len(b),b"BIN\0")+b
        path=OUT/"models"/filename
        path.write_bytes(raw)
        return path

    def batch_static_parts(self):
        """Bake sibling decoration per material; keep anchors/movable parts intact."""
        preserved={"hit_surface","lens_front","lens_rear","turret_elevation","turret_windage","parallax_knob","zoom_ring"}
        def read_accessor(i):
            a=self.doc["accessors"][i];v=self.doc["bufferViews"][a["bufferView"]]
            width={"SCALAR":1,"VEC2":2,"VEC3":3}[a["type"]]
            count=a["count"]*width
            return list(struct.unpack_from("<"+("f" if a["componentType"]==5126 else "H")*count,self.data,v["byteOffset"]))
        def rotate(v,q):
            x,y,z=v;qx,qy,qz,qw=q
            ux=qy*z-qz*y;uy=qz*x-qx*z;uz=qx*y-qy*x
            vx=qy*uz-qz*uy;vy=qz*ux-qx*uz;vz=qx*uy-qy*ux
            return [x+2*(qw*ux+vx),y+2*(qw*uy+vy),z+2*(qw*uz+vz)]
        for parent_i,parent in list(enumerate(self.doc["nodes"])):
            groups={}
            for node_i in list(parent.get("children",[])):
                node=self.doc["nodes"][node_i]
                if "mesh" not in node or node.get("children") or node["name"] in preserved:continue
                primitive=self.doc["meshes"][node["mesh"]]["primitives"][0]
                groups.setdefault(primitive["material"],[]).append((node,primitive))
            for mat,parts in groups.items():
                if len(parts)<2:continue
                positions=[];normals=[];indices=[]
                for node,prim in parts:
                    p=read_accessor(prim["attributes"]["POSITION"])
                    n=read_accessor(prim["attributes"]["NORMAL"])
                    ix=read_accessor(prim["indices"])
                    base=len(positions)//3
                    scale=node.get("scale",[1,1,1]);translation=node.get("translation",[0,0,0]);q=node.get("rotation",[0,0,0,1])
                    for i in range(0,len(p),3):
                        xyz=rotate([p[i+j]*scale[j] for j in range(3)],q)
                        positions.extend([xyz[j]+translation[j] for j in range(3)])
                        normal=rotate([n[i+j]/scale[j] for j in range(3)],q)
                        length=math.sqrt(sum(a*a for a in normal))
                        normals.extend([a/length for a in normal])
                    indices.extend([base+i for i in ix])
                    del node["mesh"]
                self.node(f"static_batch_{parent_i}_{mat}",mesh=self.mesh(f"baked-{parent_i}-{mat}",positions,normals,indices,mat),parent=parent_i)


def scope(g, mats, kind="precision", integrated=False):
    metal, rubber, glass = mats
    root = g.node("optic_root")
    # Lens planes are perpendicular to the barrel, at realistic lens positions.
    y=.153 if integrated else 0
    z=.025
    radius={"field":.021,"precision":.026,"survey":.032}[kind]
    g.cylinder("optic_tube",(0,y,z),.016,.32,metal,parent=root)
    g.cylinder("objective_bell",(0,y,z+.18),radius,.085,metal,taper=.91,parent=root)
    g.cylinder("ocular_bell",(0,y,z-.19),.024,.075,metal,parent=root)
    for k in range(9):
        g.cylinder(f"ocular_knurl_{k}",(0,y,z-.22+k*.005),.025,.002,rubber,parent=root)
    g.cylinder("lens_front",(0,y,z+.224),radius*.86,.002,glass,parent=root)
    g.cylinder("lens_rear",(0,y,z-.229),.021,.002,glass,parent=root)
    g.cylinder("turret_elevation",(0,y+.035,z+.005),.018,.035,metal,axis="y",parent=root)
    g.cylinder("turret_windage",(.032,y,z+.005),.017,.03,metal,axis="x",parent=root)
    g.cylinder("parallax_knob",(-.032,y,z+.005),.015,.025,metal,axis="x",parent=root)
    g.cylinder("zoom_ring",(0,y,z-.125),.021,.037,rubber,parent=root)
    for side in [-1,1]:
        for k in range(7):
            g.box(f"turret_knurl_{side}_{k}",(side*.017,y+.039,z-.01+k*.005),(.005,.025,.0025),rubber,parent=root)
    for i,zv in enumerate([-.065,.11]):
        g.box(f"scope_ring_base_{i}",(0,y-.042,zv),(.034,.036,.026),metal,parent=root)
        g.cylinder(f"scope_ring_{i}",(0,y,zv),.019,.014,metal,parent=root)
    g.node("eye_point",(0,y,z-.265),parent=root)
    return root


def make_rifle(kind):
    g=GLB(kind)
    metal=g.material("blued steel",(.075,.091,.096),.84,.32)
    machined=g.material("machined edges",(.19,.21,.21),.8,.38)
    black=g.material("rubber",(.024,.029,.026),0,.89)
    accent_color={"ranger":(.24,.125,.066),"sentinel":(.36,.37,.26),"kestrel":(.29,.25,.18),"atlas":(.43,.38,.28)}[kind]
    body=g.material("walnut" if kind=="ranger" else "ceramic polymer",accent_color,.03,.68)
    brass=g.material("brass details",(.56,.39,.13),.78,.32)
    glass=g.material("coated optical glass",(.016,.095,.105),.65,.13,emissive=(.006,.027,.03))
    glove=g.material("olive glove fabric",(.10,.135,.097),0,.93)
    seam=g.material("glove seam",(.22,.25,.17),0,.9)
    length={"ranger":.98,"sentinel":1.15,"kestrel":1.02,"atlas":1.29}[kind]
    back=-.49 if kind=="ranger" else -.53
    muzzle=back+length
    barrel_end=muzzle-.018
    g.cylinder("barrel",(0,.031,(.12+barrel_end)/2),.014 if kind=="ranger" else .019,(barrel_end-.12),metal,taper=.73)
    g.cylinder("receiver",(0,.031,-.015),.034,.30,metal)
    g.box("receiver_flat",(0,.034,-.005),(.067,.063,.29),metal)
    g.box("ejection_port_inset",(.034,.05,-.035),(.002,.029,.105),black)
    g.node("ejection_port",(.04,.05,-.035))
    g.node("scope_mount",(0,.108,.025))
    g.node("muzzle",(0,.031,muzzle))
    g.node("grip_r",(.025,-.09,-.17))
    g.node("grip_l",(-.024,-.038,.19))
    # Distinct stock profiles, with inset cheek pieces and butt pads.
    if kind=="ranger":
        g.profile("walnut_stock",[(.04,-.14),(.055,-.28),(.025,back),(-.10,back),(-.11,-.35),(-.05,-.22),(-.05,-.13)],.065,body)
        g.profile("walnut_forearm",[(.006,-.12),(.009,.24),(-.025,.32),(-.054,.23),(-.054,-.13)],.059,body)
        for side in [-1,1]:
            for k in range(9):
                g.box(f"stock_checkering_{side}_{k}",(side*.033,-.027,-.335+k*.011),(.0015,.031,.002),machined,quat((1,0,0),.4))
        g.box("cheek_piece",(0,.029,-.365),(.07,.037,.16),body)
    else:
        g.box("chassis_bed",(0,-.017,.025),(.075,.07,.39),body)
        g.box("stock_spine",(0,-.004,-.355),(.038,.035,.29),machined)
        g.box("stock_lower_strut",(0,-.084,-.355),(.023,.025,.27),body,quat((1,0,0),-.12))
        g.box("cheek_riser",(0,.024,-.365),(.073,.044,.19),body)
        for z in [-.425,-.305]:
            g.cylinder("cheek_support",(0,-.004,z),.008,.045,machined,axis="y")
        g.box("butt_adjustment",(0,-.025,back+.035),(.066,.122,.052),body)
        g.cylinder("stock_adjust_knob",(.045,-.031,-.38),.013,.018,machined,axis="x")
        if kind=="kestrel":
            g.cylinder("buffer_tube",(0,.011,-.255),.024,.20,metal)
            g.box("forward_assist",(.043,.046,-.14),(.031,.023,.04),metal)
    g.box("butt_pad",(0,-.039,back),(.073,.15,.026),black,quat((1,0,0),.08))
    for k in range(8):
        g.box(f"pad_rib_{k}",(0,-.10+k*.017,back-.015),(.071,.006,.005),black)
    # Grip, trigger guard, detachable magazine, rails and action details.
    g.box("pistol_grip",(0,-.106,-.158),(.051,.15,.06),body,quat((1,0,0),-.29))
    for side in [-1,1]:
        for k in range(6):
            g.box(f"grip_rib_{side}_{k}",(side*.026,-.065-k*.017,-.151),(.003,.004,.049),black)
    g.box("trigger_guard_base",(0,-.094,-.052),(.014,.009,.1),metal)
    g.box("trigger_guard_front",(0,-.062,-.004),(.014,.068,.009),metal)
    g.box("trigger",(0,-.061,-.065),(.009,.042,.009),machined,quat((1,0,0),.18))
    mag_h=.14 if kind=="kestrel" else .09
    magazine=g.node("magazine",(0,-.061,.052))
    g.box("magazine_body",(0,-mag_h/2,0),(.044,mag_h,.075),metal,parent=magazine)
    g.box("magazine_floor",(0,-mag_h,0),(.053,.009,.085),black,parent=magazine)
    for side in [-1,1]:
        for k in range(3):
            g.box(f"magazine_groove_{side}_{k}",(side*.023,-mag_h/2,-.025+k*.025),(.002,mag_h*.75,.003),machined,parent=magazine)
    bolt=g.node("bolt",(.04,.039,-.08))
    g.cylinder("bolt_handle",(.033,0,0),.007,.067,machined,axis="x",parent=bolt)
    g.cylinder("bolt_knob",(.068,-.007,0),.014,.027,black,axis="y",segments=16,parent=bolt)
    g.box("upper_rail",(0,.074,.024),(.041,.016,.34),metal)
    for k in range(23):
        g.box(f"rail_tooth_{k}",(0,.085,-.132+k*.014),(.049,.009,.006),machined)
    if kind!="ranger":
        hand_len=.27 if kind=="kestrel" else .33
        g.box("handguard",(0,-.012,.18+hand_len/3),(.072,.074,hand_len),body)
        for side in [-1,1]:
            for k in range(8):
                g.box(f"vent_{side}_{k}",(side*.037,.005,.13+k*.028),(.002,.018,.017),black)
                g.box(f"lower_vent_{side}_{k}",(side*.037,-.024,.13+k*.028),(.002,.008,.017),black)
        for k in range(16):
            g.box(f"fore_rail_{k}",(0,.037,.095+k*.018),(.065,.009,.007),machined)
    for z in [-.11,.105]:
        g.cylinder(f"receiver_pin_{z}",(.037,.007,z),.007,.004,machined,axis="x",segments=12)
    g.cylinder("muzzle_brake",(0,.031,muzzle-.014),.018 if kind=="ranger" else .027,.046,metal)
    g.cylinder("muzzle_dark_bore",(0,.031,muzzle+.0095),.007,.001,black)
    for k in range(3):
        for side in [-1,1]:
            g.box(f"brake_slot_{side}_{k}",(side*(.018 if kind=="ranger" else .027),.031,muzzle-.03+k*.012),(.001,.018,.005),black)
    scope(g,(metal,black,glass),"field" if kind=="ranger" else "survey" if kind=="atlas" else "precision",True)
    # Bipod is visible on precision/heavy variants, folded on the semi-auto.
    if kind in ["sentinel","atlas"]:
        for side in [-1,1]:
            g.box(f"bipod_leg_{side}",(side*.08,-.145,.30),(.018,.24,.022),metal,quat((0,0,1),side*.35))
            g.box(f"bipod_foot_{side}",(side*.12,-.255,.30),(.055,.016,.065),black)
        g.cylinder("bipod_hinge",(0,-.043,.30),.021,.09,machined,axis="x")
    # Gloved hands are grouped so the app may move/hide them for inspection.
    hands=g.node("hands")
    for side,pos in [("r",(.039,-.115,-.153)),("l",(-.043,-.061,.22))]:
        hand=g.node("hand_"+side,pos,parent=hands)
        g.box("palm_"+side,(0,0,0),(.047,.075,.07),glove,quat((1,0,0),-.2),parent=hand)
        g.box("cuff_"+side,(0,-.055,-.014),(.063,.045,.068),black,parent=hand)
        g.box("knuckle_pad_"+side,((.026 if side=="r" else -.026),.004,0),(.008,.045,.054),black,parent=hand)
        for k in range(4):
            g.cylinder(f"finger_{side}_{k}",(-.006,.026-k*.016,.03),.009,.054,glove,axis="x",segments=12,parent=hand)
            g.box(f"finger_seam_{side}_{k}",(.018,.027-k*.016,.037),(.019,.003,.004),seam,parent=hand)
        g.cylinder("thumb_"+side,(-.013,.025,-.015),.012,.038,glove,axis="y",segments=12,parent=hand)
    # Small original two-line brass serial inlay, not a real brand marking.
    g.box("serial_inlay",(.038,.006,-.035),(.001,.013,.045),brass)
    path=g.write(kind+".glb")
    return path,{"lengthM":round(length+.028,3),"muzzle":[0,.031,round(muzzle,3)],"eye_point":[0,.153,-.24],"scope_mount":[0,.108,.025],"forward":"+Z","up":"+Y"}


def target(kind):
    g=GLB(kind)
    steel=g.material("powder coated frame",(.11,.14,.13),.5,.65)
    white=g.material("warm target white",(.91,.89,.79),0,.91)
    dark=g.material("charcoal score zone",(.022,.026,.023),0,.9)
    red=g.material("vermilion center",(.72,.16,.075),0,.72)
    wood=g.material("aged stand",(.27,.23,.16),0,.95)
    root=g.node("target_root")
    # The hittable face is centered at the model origin. Stand is below it.
    pivot=g.node("reaction_pivot",parent=root)
    if kind=="paper":
        g.box("backing",(0,0,.022),(1.08,1.18,.045),wood,parent=pivot)
        g.box("hit_surface",(0,0,-.005),(1,1.1,.015),white,parent=pivot)
        for i,(r,m) in enumerate([(.40,dark),(.32,white),(.245,dark),(.17,white),(.095,red),(.025,dark)]):
            g.cylinder(f"score_ring_{i}",(0,0,-.015-i*.0015),r,.0015,m,segments=64,parent=pivot)
    elif kind=="reactive":
        g.box("machine_housing",(0,-.15,.06),(.95,1.05,.15),steel,parent=root)
        g.cylinder("hit_surface",(0,0,-.04),.38,.07,white,segments=48,parent=pivot)
        g.cylinder("actuator_center",(0,0,-.078),.12,.006,red,segments=32,parent=pivot)
        for side in [-1,1]:
            g.cylinder(f"hinge_{side}",(side*.46,.25,0),.047,.10,steel,axis="x",parent=root)
    else:
        r=.5 if kind=="gong" else .42
        g.cylinder("hit_surface",(0,0,0),r,.045,white,segments=48,parent=pivot)
        g.cylinder("center_mark",(0,0,-.025),r*.18,.002,red,segments=32,parent=pivot)
        for side in [-1,1]:
            g.box(f"chain_{side}",(side*.29,.57,.01),(.018,.50,.018),steel,parent=root)
        g.box("crossbar",(0,.86,.03),(1.5,.07,.07),steel,parent=root)
    for side in [-1,1]:
        g.box(f"stand_{side}",(side*.62,-.45,.05),(.055,2.6,.055),steel,parent=root)
        g.box(f"foot_{side}",(side*.62,-1.73,.05),(.25,.06,.7),steel,parent=root)
    return g.write("target_"+kind+".glb")


def make_flag():
    g=GLB("wind_flag")
    steel=g.material("galvanized pole",(.29,.32,.31),.7,.5)
    fabric=g.material("orange fabric",(.91,.32,.10),0,.96)
    g.cylinder("pole",(0,1.35,0),.022,2.7,steel,axis="y",segments=16)
    flag=g.node("flag",(0,2.5,0))
    g.box("fabric",(.45,-.10,0),(.9,.2,.007),fabric,parent=flag)
    g.cylinder("foot",(0,.03,0),.25,.06,steel,axis="y")
    return g.write("wind_flag.glb")


SAMPLE_RATE=22050


def write_wav(name,samples):
    samples=list(samples)
    peak=max(max(abs(s) for s in samples),.001)
    pcm=array.array("h",(int(max(-1,min(1,s/peak*.88))*32767) for s in samples))
    path=OUT/"audio"/(name+".wav")
    with wave.open(str(path),"wb") as wav:
        wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(SAMPLE_RATE);wav.writeframes(pcm.tobytes())
    return path


def ambient():
    # Frequencies are quantized to the loop period, giving seamless harmonic beds.
    duration=16
    rng=random.Random(2811)
    phases=[rng.random()*TAU for _ in range(7)]
    freqs=[55,82.375,110,130.8125,164.8125,220,261.625]
    out=[];filtered=0
    count=int(duration*SAMPLE_RATE)
    noise=[rng.uniform(-1,1) for _ in range(count)]
    for i in range(count):
        t=i/SAMPLE_RATE
        filtered=.995*filtered+.005*noise[i]
        drift=.72+.28*math.sin(TAU*t/duration)
        bed=sum(math.sin(TAU*f*t+phases[j])/(j+2) for j,f in enumerate(freqs))*.14*drift
        arp=0
        for j,offset in enumerate([0,2,4,6,8,10,12,14]):
            elapsed=(t-offset)%duration
            f=[440,523.25,659.25,587.3125,440,523.25,783.9375,659.25][j]
            arp+=(math.sin(TAU*f*elapsed)+.3*math.sin(TAU*f*2*elapsed))*math.exp(-elapsed*1.6)*min(1,elapsed*30)*.025
        # Broad, gentle atmosphere instead of an exposed pure sine tone.
        out.append(bed+arp+filtered*.10)
    # Crossfade the ends to remove residual ambient/pluck discontinuities.
    fade=int(.2*SAMPLE_RATE)
    seam=(out[0]+out[-1])/2
    for i in range(fade):
        blend=i/fade
        out[i]=seam*(1-blend)+out[i]*blend
        out[-1-i]=seam*(1-blend)+out[-1-i]*blend
    return write_wav("ambient",out)


def effect(name,kind="shot",weight=1):
    rng=random.Random(name)
    durations={"shot":.85,"bolt":.55,"reload":1.1,"metal":1.8,"paper":.20,"dirt":.38,"click":.10,"success":1.8}
    duration=durations[kind]
    out=[];low=0
    for i in range(int(duration*SAMPLE_RATE)):
        t=i/SAMPLE_RATE;noise=rng.uniform(-1,1);low=.88*low+.12*noise
        if kind=="shot":
            crack=noise*math.exp(-t*110)*min(1,t*3000)
            boom=(math.sin(TAU*(52/weight)*t)+.28*math.sin(TAU*113*t))*math.exp(-t*(14/weight))*.68
            tail=low*math.exp(-t*6)*.8
            reflected=0
            for delay,gain in [(.08,.22),(.17,.13),(.31,.07)]:
                if t>delay:reflected+=noise*math.exp(-(t-delay)*38)*gain
            s=crack*.9+boom+tail+reflected
        elif kind in ["bolt","reload","click"]:
            s=0
            pulses={"bolt":[(.01,.6),(.16,.4),(.29,.8),(.41,.5)],"reload":[(.01,.45),(.16,.38),(.55,.75),(.73,.40),(.89,.58)],"click":[(.002,.7)]}[kind]
            for at,gain in pulses:
                dt=t-at
                if dt>=0:
                    s+=gain*(noise*.6+math.sin(TAU*1850*dt)*.3+math.sin(TAU*760*dt)*.4)*math.exp(-dt*95)
        elif kind=="metal":
            s=noise*.2*math.exp(-t*120)
            for f,gain,decay in [(631,1,2.7),(1097,.45,3.9),(1643,.24,4.3),(2371,.12,6.5),(3413,.06,8)]:
                s+=math.sin(TAU*f*t)*math.exp(-t*decay)*gain*.4
        elif kind=="paper":s=(noise-low)*math.exp(-t*38)*min(1,t*2000)
        elif kind=="dirt":s=(low*.9+noise*.15)*math.exp(-t*16)*min(1,t*2000)
        else:
            s=0
            for start,f in [(0,293.66),(.18,349.23),(.36,440),(.54,587.33)]:
                dt=t-start
                if dt>=0:s+=(math.sin(TAU*f*dt)+.2*math.sin(TAU*f*2*dt))*math.exp(-dt*3.7)*min(1,dt*90)*.25
        # Anti-click envelope; the intentional attack transient remains.
        s*=min(1,t*2000)*min(1,(duration-t)*100)
        out.append(s)
    return write_wav(name,out)


def main():
    (OUT/"models").mkdir(parents=True,exist_ok=True)
    (OUT/"audio").mkdir(parents=True,exist_ok=True)
    files=[];anchors={}
    for kind in ["ranger","sentinel","kestrel","atlas"]:
        path,meta=make_rifle(kind);files.append(path);anchors[kind]=meta
    for kind in ["paper","gong","plate","reactive"]:files.append(target(kind))
    files.append(make_flag())
    for kind in ["field","precision","survey"]:
        g=GLB("scope_"+kind)
        mats=(g.material("steel",(.06,.075,.08),.8,.3),g.material("rubber",(.02,.023,.02),0,.85),g.material("coated glass",(.02,.1,.11),.7,.12))
        scope(g,mats,kind);files.append(g.write("scope_"+kind+".glb"))
    files.append(ambient())
    for kind,weight in [("ranger",.8),("sentinel",1),("kestrel",.95),("atlas",1.3)]:files.append(effect("shot_"+kind,weight=weight))
    for name,kind in [("bolt","bolt"),("reload","reload"),("impact_metal","metal"),("impact_paper","paper"),("impact_dirt","dirt"),("click","click"),("success","success")]:files.append(effect(name,kind))
    manifest={"version":1,"generator":"scripts/generate-assets.py","coordinateSystem":{"up":"+Y","forward":"+Z","units":"meters"},"rifleAnchors":anchors,"assets":[]}
    for p in files:
        b=p.read_bytes()
        manifest["assets"].append({"id":p.stem,"path":str(p.relative_to(OUT)),"type":"model/gltf-binary" if p.suffix==".glb" else "audio/wav","sizeBytes":len(b),"sha256":hashlib.sha256(b).hexdigest(),"author":"SNIPE project","source":"Original procedural asset","sourceUrl":None,"license":"CC0-1.0","modifications":"Generated from project source; no external media."})
    (OUT/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"files":len(files),"bytes":sum(p.stat().st_size for p in files),"rifleAnchors":anchors},indent=2))


if __name__=="__main__":main()
