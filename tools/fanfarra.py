"""Original opening fanfare for Lontrax Addons (synthesized, no samples, no copyright issues).
    python tools/fanfarra.py assets/fanfarra.wav
"""
import sys, wave
import numpy as np

SR = 44100


def note_hz(name):
    names = {'C': -9, 'D': -7, 'E': -5, 'F': -4, 'G': -2, 'A': 0, 'B': 2}
    n = names[name[0]]
    i = 1
    if name[i:i + 1] in ('#', 'b'):
        n += 1 if name[i] == '#' else -1
        i += 1
    octave = int(name[i:])
    return 440.0 * 2 ** ((n + (octave - 4) * 12) / 12)


def brass(freq, dur, vel=1.0):
    """Brass-like tone: harmonics that open up after the attack, light vibrato."""
    t = np.arange(int(SR * dur)) / SR
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.2 * t) * np.clip((t - 0.12) * 4, 0, 1)
    phase = 2 * np.pi * freq * np.cumsum(vib) / SR
    bright = 0.35 + 0.65 * np.clip(t / 0.06, 0, 1)
    out = np.zeros_like(t)
    for h in range(1, 11):
        amp = (1 / h ** 1.1) * (bright ** (h * 0.35))
        out += amp * np.sin(h * phase)
    att = np.clip(t / 0.025, 0, 1)
    rel = np.clip((dur - t) / 0.08, 0, 1)
    sus = 0.85 + 0.15 * np.exp(-t * 6)
    return out * att * rel * sus * vel


def timpani(dur, freq=72.0, vel=1.0):
    t = np.arange(int(SR * dur)) / SR
    f = freq * (1 + 0.25 * np.exp(-t * 30))
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 4.5)
    rng = np.random.default_rng(7)
    noise = rng.standard_normal(len(t)) * np.exp(-t * 40) * 0.35
    return (body + noise) * vel


def place(buf, sig, start):
    i = int(start * SR)
    end = min(len(buf), i + len(sig))
    buf[i:end] += sig[:end - i]


total = 3.4
mix = np.zeros(int(SR * total))

# Original motif in C major: a quick call, a leap up, and a held triumphant chord.
melody = [
    ('G4', 0.00, 0.16, 0.8), ('G4', 0.19, 0.12, 0.7), ('C5', 0.34, 0.42, 1.0),
    ('E5', 0.80, 0.16, 0.85), ('D5', 0.99, 0.16, 0.8), ('G5', 1.18, 0.30, 1.0),
    ('E5', 1.50, 0.14, 0.8), ('C6', 1.68, 1.55, 1.0),
]
for name, start, dur, vel in melody:
    f = note_hz(name)
    place(mix, brass(f, dur, vel) * 0.55, start)
    place(mix, brass(f / 2, dur, vel) * 0.35, start)  # octave below, fuller sound

# Final chord (C major) under the last note.
for name in ('C4', 'E4', 'G4', 'C5'):
    place(mix, brass(note_hz(name), 1.55, 0.7) * 0.22, 1.68)

# Timpani: pickup hits and a final roll.
for s, v in ((0.0, 0.5), (0.34, 0.9), (1.18, 0.7)):
    place(mix, timpani(1.0, 65.4, v) * 0.6, s)
for k in range(10):
    place(mix, timpani(0.6, 65.4, 0.25 + 0.05 * k) * 0.5, 1.68 + k * 0.055)
place(mix, timpani(1.6, 65.4, 1.0) * 0.7, 2.25)

# Simple hall reverb (a few feedback delays).
wet = np.zeros_like(mix)
for d, g in ((0.031, 0.35), (0.047, 0.3), (0.071, 0.25), (0.113, 0.2)):
    n = int(SR * d)
    tmp = np.copy(mix)
    for _ in range(6):
        tmp = np.concatenate([np.zeros(n), tmp[:-n]]) * g
        wet += tmp
mix = mix + wet * 0.6

# Fade out the tail, normalize to a comfortable level.
fade = np.ones_like(mix)
fl = int(SR * 0.6)
fade[-fl:] = np.linspace(1, 0, fl)
mix *= fade
mix = mix / np.max(np.abs(mix)) * 0.6

out = sys.argv[1] if len(sys.argv) > 1 else 'fanfarra.wav'
with wave.open(out, 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype(np.int16).tobytes())
print('ok', out, round(len(mix) / SR, 2), 's')
