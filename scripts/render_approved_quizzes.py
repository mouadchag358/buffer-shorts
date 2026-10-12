#!/usr/bin/env python3
"""Render 100 bright English quizzes from the approved pop culture illustration collage."""
from PIL import Image, ImageDraw, ImageFont, ImageEnhance
from pathlib import Path
import math, json

SOURCE=Path("pop-culture/reference-artwork.jpg")
DEST=Path("pop-culture/cards")
FONT="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
CARDS=json.loads(Path("pop-culture/questions.json").read_text())
QUESTIONS=[(c["category"].upper(),c["question"],c["options"]) for c in CARDS]
PALETTES=[
 ("#41A6F2","#FFB43A"),("#42C9EF","#FFDB74"),("#5468F1","#57DFFB"),
 ("#E5883D","#7E9FEC"),("#8844E1","#F9A65A"),("#3EC8EE","#7BE281"),
 ("#57D5EC","#EEDD6C"),("#7151B0","#D6548B"),("#0BB4EE","#FF9C52"),
 ("#53BEEE","#9BE3B4")
]
def f(size):
 return ImageFont.truetype(FONT,size)
def wrap(draw,txt,sz,width,maxlines=2):
 words=txt.split()
 for pt in range(sz,17,-1):
  font=f(pt);lines=[];line=""
  for w in words:
   proposed=(line+" "+w).strip()
   if line and draw.textbbox((0,0),proposed,font=font)[2]>width:
    lines.append(line);line=w
   else: line=proposed
  if line:lines.append(line)
  if len(lines)<=maxlines and all(draw.textbbox((0,0),ln,font=font)[2]<=width for ln in lines):
   return font,lines
 raise RuntimeError("Text too long: "+txt)
def drawcard(source,i):
 category,question,options=QUESTIONS[i]
 art_index=CARDS[i].get("artworkIndex",i)
 row,col=divmod(art_index,5)
 x0=round(col*source.width/5);x1=round((col+1)*source.width/5)
 y0=round(row*source.height/2);y1=round((row+1)*source.height/2)
 panel=source.crop((x0,y0,x1,y1))
 # This is the real approved character art, not a geometrical replacement.
 artwork=panel.crop((0,round(panel.height*.08),panel.width,round(panel.height*.605)))
 artwork=ImageEnhance.Color(artwork).enhance(1.08)
 sky,burst=PALETTES[art_index]
 img=Image.new("RGB",(1080,1080),sky);d=ImageDraw.Draw(img)
 for y in range(0,1080,6):
  frac=y/1080
  left=tuple(int(sky[1+n*2:3+n*2],16) for n in range(3))
  right=tuple(int(burst[1+n*2:3+n*2],16) for n in range(3))
  color=tuple(round(a*(1-frac*.25)+b*frac*.25) for a,b in zip(left,right))
  d.rectangle((0,y,1080,y+6),fill=color)
 d.ellipse((430,-250,1300,590),fill=burst)
 d.ellipse((535,-170,1260,520),fill="#F8E392")
 d.ellipse((635,-65,1150,440),fill="#A8E1F8")
 for k in range(18):
  angle=k*math.tau/18
  d.line((790+315*math.cos(angle),292+315*math.sin(angle),790+670*math.cos(angle+.05),292+670*math.sin(angle+.05)),fill="white",width=13)
 width=630
 art=artwork.resize((width,round(width*artwork.height/artwork.width)),Image.Resampling.LANCZOS)
 mask=Image.new("L",art.size,255);md=ImageDraw.Draw(mask)
 for x in range(85):
  md.line((x,0,x,art.height),fill=int(255*(x/85)**1.5))
 for y in range(art.height-90,art.height):
  md.line((0,y,art.width,y),fill=max(0,int(255*(art.height-y)/90)))
 img.paste(art,(470,-145),mask)
 d=ImageDraw.Draw(img)
 for word,sz,y in [("POP",86,107),("CULTURE",81,207),("QUIZ",98,319)]:
  d.text((49,y),word,font=f(sz),fill="#FFDC36" if word!="QUIZ" else "#FFFFFF",stroke_width=6,stroke_fill="#17213F")
 d.rounded_rectangle((54,420,270,469),radius=20,fill="#111B3C",outline="white",width=4)
 d.text((162,446),category,font=f(24),anchor="mm",fill="#FFF6BD")
 d.rounded_rectangle((891,24,1043,95),radius=30,fill="#15203D",outline="white",width=5)
 d.text((967,59),(str(i+1)+"/10" if i<10 else "#"+str(i+1)),font=f(38),fill="white",anchor="mm")
 d.rounded_rectangle((34,607,1047,776),radius=28,fill="#101A35",outline="#FFD23D",width=9)
 question_font,question_lines=wrap(d,question,56,930)
 lineheight=question_font.size+12
 top=690-len(question_lines)*lineheight/2+question_font.size*.06
 for k,line in enumerate(question_lines):
  d.text((540,top+k*lineheight),line,font=question_font,fill="white",anchor="mt")
 for k,opt in enumerate(options):
  x=45+(k%2)*510;y=790+(k//2)*110
  fill=["#FE5366","#2AB9F8","#21D58A","#FFDD51"][k]
  d.rounded_rectangle((x,y,x+482,y+96),radius=23,fill=fill,outline="#1A2343",width=8)
  d.rounded_rectangle((x+11,y+9,x+470,y+25),radius=10,fill="white")
  d.ellipse((x+15,y+15,x+80,y+81),fill="#182442",outline="white",width=4)
  d.text((x+47,y+49),"ABCD"[k],anchor="mm",font=f(38),fill="white")
  optfont,_=wrap(d,opt,32,370,1)
  d.text((x+93,y+46),opt,font=optfont,fill="#102040",anchor="lm")
 d.text((540,1042),"COMMENT A, B, C OR D!",font=f(31),fill="white",anchor="mm",stroke_width=4,stroke_fill="#18223C")
 target=DEST/("quiz-%03d.jpg"%(i+1))
 img.save(target,format="JPEG",quality=92,optimize=True,progressive=True,subsampling=0)
 if target.stat().st_size<70000:raise RuntimeError("Suspicious output size: "+str(target))
 print("Rendered",target,target.stat().st_size)
def main():
 if not SOURCE.exists():raise FileNotFoundError(SOURCE)
 DEST.mkdir(exist_ok=True,parents=True)
 image=Image.open(SOURCE).convert("RGB")
 if image.width<900 or image.height<900:raise ValueError("Approved illustration too small")
 for i in range(len(CARDS)):drawcard(image,i)
if __name__=="__main__":main()
