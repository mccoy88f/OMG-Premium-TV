import numpy as np, wave
SR=44100; DUR=10.0; N=int(SR*DUR)
BPM=112; beat=60/BPM; s16=beat/4
out=np.zeros((N,2))
rng=np.random.default_rng(7)
def add(sig,t,pan=0.0,gain=1.0):
    i=int(t*SR)
    if i>=N: return
    sig=sig[:N-i]*gain
    out[i:i+len(sig),0]+=sig*(1-max(pan,0))
    out[i:i+len(sig),1]+=sig*(1+min(pan,0))
def env(n,a,d):
    t=np.arange(n)/SR; e=np.exp(-t/d); k=int(a*SR)
    if k>0: e[:k]*=np.linspace(0,1,k)
    return e
def lp(x,c):
    y=np.zeros_like(x); a=c; s=0.0
    for i in range(len(x)): s+=a*(x[i]-s); y[i]=s
    return y
def lp_fast(x,cut):
    # simple FFT lowpass
    X=np.fft.rfft(x); f=np.fft.rfftfreq(len(x),1/SR)
    X*=1/(1+(f/cut)**4); return np.fft.irfft(X,len(x))
def kick():
    n=int(.35*SR); t=np.arange(n)/SR
    f=50+110*np.exp(-t/0.03); ph=2*np.pi*np.cumsum(f)/SR
    return np.sin(ph)*np.exp(-t/0.12)*1.0+ (rng.standard_normal(n)*np.exp(-t/0.003))*0.2
def snare(g=1.0):
    n=int(.25*SR); t=np.arange(n)/SR
    nz=lp_fast(rng.standard_normal(n),7000)*np.exp(-t/0.07)
    tone=np.sin(2*np.pi*190*t)*np.exp(-t/0.05)
    return (nz*0.6+tone*0.5)*g
def hat(open_=False):
    n=int((.25 if open_ else .05)*SR); t=np.arange(n)/SR
    x=rng.standard_normal(n); x=x-lp_fast(x,6000)
    return x*np.exp(-t/(0.09 if open_ else 0.015))*0.35
def note(m): return 440*2**((m-69)/12)
def bass(m,dur,pop=False):
    n=int(dur*SR); t=np.arange(n)/SR; f=note(m)
    saw=2*((t*f)%1)-1
    sq=np.sign(np.sin(2*np.pi*f*t))
    x=0.6*saw+0.4*sq
    x=lp_fast(x,900 if not pop else 2500)
    e=env(n,0.002,0.18 if not pop else 0.08)
    e[-200:]*=np.linspace(1,0,200) if n>200 else 1
    return x*e*(0.55 if not pop else 0.4)+np.sin(2*np.pi*f*t)*e*0.35
def clav(ms,dur=0.12):
    n=int(dur*SR); t=np.arange(n)/SR; x=np.zeros(n)
    for m in ms:
        f=note(m); x+=((t*f)%1<0.25).astype(float)-0.25
    x=lp_fast(x-x.mean(),3500)
    return x*env(n,0.001,0.05)*0.18
def brass(ms,dur=0.3):
    n=int(dur*SR); t=np.arange(n)/SR; x=np.zeros(n)
    for m in ms:
        f=note(m)*(1+0.003*np.sin(2*np.pi*5*t)); x+=2*((np.cumsum(f)/SR)%1)-1
    x=lp_fast(x,2200)
    e=env(n,0.02,0.25); return x*e*0.12
total16=int(DUR/s16)+1
sw=0.018
# drums
for k in range(total16):
    t=k*s16+(sw if k%2 else 0); pos=k%16
    if pos in (0,6,10): add(kick(),t,gain=0.9)
    if pos in (4,12): add(snare(),t,gain=0.8)
    if pos in (7,9,15): add(snare(0.18),t,0.2)
    if pos==14: add(hat(True),t,-0.3)
    else: add(hat(),t,-0.3,gain=1.0 if pos%2==0 else 0.6)
# bass pattern (E minor funk), per bar of 16 steps: (step,midi,len16,pop)
E=28
pat=[(0,E,2,0),(3,E+12,1,1),(4,E,1,0),(6,E+3,1,0),(7,E+5,2,0),(10,E,1,0),(11,E+12,1,1),(12,E+7,1,0),(14,E+10,1,0),(15,E+12,1,1)]
pat2=[(0,E+5,2,0),(3,E+17,1,1),(4,E+5,1,0),(6,E+8,1,0),(7,E+10,2,0),(10,E+5,1,0),(11,E+17,1,1),(12,E+7,1,0),(14,E+3,1,0),(15,E+2,1,0)]
bars=int(np.ceil(total16/16))
for b in range(bars):
    p=pat if b%2==0 else pat2
    for st,m,l,pop in p:
        t=(b*16+st)*s16+(sw if st%2 else 0)
        add(bass(m,l*s16*0.95,pop),t)
# clav chords on offbeats
ch1=[52,55,59,62,66]  # Em9
ch2=[57,61,64,67,71]  # A13ish
for b in range(bars):
    ch=ch1 if b%2==0 else ch2
    for st in (2,5,8,10,13,15):
        add(clav(ch),(b*16+st)*s16+(sw if st%2 else 0),0.35)
# brass hits at start and bar 2
for b,ch in [(0,[64,67,71,74]),(2,[64,67,71,74]),(4,[69,73,76,79])]:
    for st in (0,):
        add(brass(ch,0.35),(b*16+st)*s16,0.0)
# final hit
add(brass([64,67,71,74,76],1.2),9.0); add(kick(),9.0); 
# master
x=out
x=np.tanh(x*1.4)
fade=int(0.8*SR); x[-fade:]*=np.linspace(1,0,fade)[:,None]
x[:int(0.01*SR)]*=np.linspace(0,1,int(0.01*SR))[:,None]
x/=np.max(np.abs(x))*1.12
d=(x*32767).astype(np.int16)
w=wave.open('funky_civico39.wav','wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(d.tobytes()); w.close()
print('ok')
