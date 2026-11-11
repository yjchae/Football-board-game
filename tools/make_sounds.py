"""
경기 효과음 음원 만들기 (녹음 대신 물리 모델링으로 합성)

  python3 tools/make_sounds.py      # numpy, ffmpeg 필요

만드는 파일 → src/assets/sounds/*.mp3
  whistle-kickoff.mp3   심판 휘슬 1번 (킥오프·후반 시작)
  whistle-halftime.mp3  휘슬 2번 (전반 종료)
  whistle-fulltime.mp3  휘슬 3번 (경기 종료)
  crowd-goal.mp3        골 함성 (수백 명의 "와아아!" + 박수 + 경기장 울림)
  crowd-save.mp3        슈퍼 세이브 탄성 ("오오오!" → 박수)

실제 녹음 파일로 바꾸고 싶으면 같은 이름의 mp3로 덮어쓰면 된다.
(앱은 파일 이름만 보고 불러오므로 코드를 고칠 필요 없음)
"""

import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

SR = 44100
OUT = Path(__file__).resolve().parent.parent / "src" / "assets" / "sounds"
rng = np.random.default_rng(20261111)  # 같은 음원이 나오도록 고정


# ─────────────── 공통 도구 ───────────────

def t_axis(seconds: float) -> np.ndarray:
    return np.arange(int(SR * seconds)) / SR


def smooth_noise(n: int, rate_hz: float) -> np.ndarray:
    """천천히 출렁이는 무작위 곡선 (-1~1): 사람 숨결·관중 물결 같은 불규칙함"""
    points = max(2, int(n / SR * rate_hz) + 2)
    ctrl = rng.uniform(-1, 1, points)
    return np.interp(np.linspace(0, points - 1, n), np.arange(points), ctrl)


def spectral_filter(signal: np.ndarray, gain_fn) -> np.ndarray:
    """주파수 영역에서 원하는 모양으로 깎는다 (gain_fn: 주파수 배열 → 배율)"""
    spec = np.fft.rfft(signal)
    freqs = np.fft.rfftfreq(len(signal), 1 / SR)
    return np.fft.irfft(spec * gain_fn(freqs), len(signal))


def highpass(freqs: np.ndarray, cutoff: float) -> np.ndarray:
    """저음을 부드럽게 줄인다 (칼같이 자르면 경계에 빈 줄이 생김)"""
    return freqs**2 / (freqs**2 + cutoff**2)


def resonance(freqs: np.ndarray, center: float, width: float) -> np.ndarray:
    """공명 봉우리 하나 (목소리 모음·호루라기 몸통)"""
    return 1.0 / (1.0 + ((freqs - center) / (width / 2)) ** 2)


def reverb(signal: np.ndarray, seconds: float, mix: float, brightness: float = 6000) -> np.ndarray:
    """경기장 울림: 점점 작아지는 잡음과 겹쳐서(컨볼루션) 공간감을 만든다"""
    ir_t = t_axis(seconds)
    ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t * 6.9 / seconds)
    # 잡음 응답은 특정 주파수가 우연히 튀어 "웅" 하는 울림이 생기므로, 크기를 평탄하게 펴고 위상만 남긴다
    spec = np.fft.rfft(ir)
    freqs = np.fft.rfftfreq(len(ir), 1 / SR)
    ir = np.fft.irfft(spec / (np.abs(spec) + 1e-12) / (1 + (freqs / brightness) ** 2), len(ir))
    ir *= np.exp(-ir_t * 6.9 / seconds)  # 평탄화로 흐트러진 감쇠 모양을 다시 맞춤
    ir /= np.sqrt(np.sum(ir**2))
    n = len(signal) + len(ir) - 1
    size = 1 << (n - 1).bit_length()
    wet = np.fft.irfft(np.fft.rfft(signal, size) * np.fft.rfft(ir, size), size)[:n]
    dry = np.concatenate([signal, np.zeros(len(ir) - 1)])
    return dry * (1 - mix) + wet * mix


def fade(signal: np.ndarray, fade_in: float = 0.005, fade_out: float = 0.05) -> np.ndarray:
    out = signal.copy()
    a, b = int(SR * fade_in), int(SR * fade_out)
    out[:a] *= np.linspace(0, 1, a)
    out[-b:] *= np.linspace(1, 0, b)
    return out


def save_mp3(name: str, signal: np.ndarray, peak_db: float = -1.0) -> None:
    signal = signal / np.max(np.abs(signal)) * 10 ** (peak_db / 20)
    pcm = (signal * 32767).astype("<i2")
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        with wave.open(tmp.name, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(pcm.tobytes())
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", tmp.name, "-codec:a", "libmp3lame", "-b:a", "96k", str(OUT / name)],
            check=True,
        )
    print(f"  {name}: {len(signal) / SR:.1f}초, {(OUT / name).stat().st_size // 1024}KB")


# ─────────────── 심판 호루라기 ───────────────
# 실제 호루라기(구슬 휘슬)는 약 3kHz 소리를 내고, 안에서 구르는 구슬이
# 공기 흐름을 초당 수십 번 끊어서 "르르르" 떨리는 소리가 난다.

def whistle_blast(seconds: float, strength: float = 1.0) -> np.ndarray:
    t = t_axis(seconds)
    n = len(t)

    # 부는 세기: 빠르게 세게 불었다가 살짝 줄고, 끝에서 뚝 끊김
    pressure = np.minimum(1, t / 0.025) * (1 - 0.12 * np.minimum(1, t / seconds))
    pressure *= 1 + 0.04 * smooth_noise(n, 9)
    release = np.clip((seconds - t) / 0.045, 0, 1)
    pressure *= release * strength

    # 구슬 떨림: 초당 28~38번, 매번 조금씩 불규칙
    trill_rate = 33 + 4 * smooth_noise(n, 3)
    trill_phase = 2 * np.pi * np.cumsum(trill_rate) / SR
    trill = np.tanh(2.2 * np.sin(trill_phase))  # 각진 파형 → 구슬이 막았다 열었다

    # 음높이: 세게 불수록 살짝 높아지고 구슬 때문에 출렁인다
    freq = 2950 + 160 * pressure + 140 * trill + 25 * smooth_noise(n, 15)
    phase = 2 * np.pi * np.cumsum(freq) / SR
    tone = np.sin(phase) + 0.22 * np.sin(2 * phase + 0.4) + 0.06 * np.sin(3 * phase + 1.1)
    tone *= 0.62 + 0.38 * (0.5 + 0.5 * trill)  # 구슬이 막을 때 소리가 작아짐

    # 숨소리 (호루라기 몸통에서 울리는 3kHz 대역 잡음)
    breath = spectral_filter(rng.standard_normal(n), lambda f: resonance(f, 3100, 1800) + 0.15 * resonance(f, 6200, 2500))
    breath /= np.max(np.abs(breath))

    return (tone * 0.85 + breath * 0.22) * pressure


def whistle_pattern(blasts: list[tuple[float, float]], gap: float) -> np.ndarray:
    parts = []
    for length, strength in blasts:
        parts += [whistle_blast(length, strength), np.zeros(int(SR * gap))]
    dry = np.concatenate(parts + [np.zeros(int(SR * 0.6))])
    return fade(reverb(dry, 0.9, 0.28, brightness=7000), 0.002, 0.3)


# ─────────────── 관중 ───────────────
# 관중 함성 = 수백 명의 목소리(모음 "아"/"오") + 박수 + 넓은 경기장 울림.
# 사람마다 음높이·시작 시각·크기가 다르게 해서 "한 사람"이 아닌 "군중"처럼 들리게 한다.

VOWELS = {
    "a": [(800, 160, 1.0), (1250, 200, 0.55), (2700, 300, 0.25)],  # "아"
    "o": [(480, 120, 1.0), (850, 160, 0.6), (2600, 300, 0.12)],  # "오"
    "e": [(600, 140, 1.0), (1900, 220, 0.45), (2700, 300, 0.25)],  # "에"
}


def vowel_filter(signal: np.ndarray, vowel: str) -> np.ndarray:
    def gain(f):
        g = sum(amp * resonance(f, c, w) for c, w, amp in VOWELS[vowel])
        return g * highpass(f, 90)
    return spectral_filter(signal, gain)


def crowd_voices(seconds: float, count: int, onset, length, pitch_glide, loudness) -> np.ndarray:
    """count명의 목소리 원음 (모음 필터 전)"""
    t = t_axis(seconds)
    n = len(t)
    out = np.zeros(n)
    for _ in range(count):
        start = onset()
        dur = length()
        base = rng.choice([rng.uniform(105, 190), rng.uniform(190, 340)], p=[0.6, 0.4])  # 어른·아이 섞임
        local = t - start
        active = (local > 0) & (local < dur)
        if not active.any():
            continue
        env = np.zeros(n)
        lt = local[active]
        env[active] = np.minimum(1, lt / rng.uniform(0.04, 0.25)) * np.clip((dur - lt) / (0.3 * dur), 0, 1)
        # 사람마다 음높이가 불규칙하게 흔들려야 배음이 한 줄로 겹쳐 "웅" 하는 기계음이 안 생긴다
        wobble = 0.04 * smooth_noise(n, rng.uniform(2, 6)) + 0.015 * np.sin(2 * np.pi * rng.uniform(4, 7) * t)
        f = base * (1 + pitch_glide(np.clip(local / dur, 0, 1))) * (1 + wobble)
        phase = 2 * np.pi * np.cumsum(f) / SR + rng.uniform(0, 2 * np.pi)
        voice = (phase / (2 * np.pi)) % 1.0 * 2 - 1  # 톱니파 = 성대 진동 근사
        voice += 0.25 * rng.standard_normal(n)  # 거친 외침 섞기
        out += voice * env * loudness()
    return out


def claps(seconds: float, start: float, density: float, rise: float = 0.8) -> np.ndarray:
    """박수 소리: 짧은 잡음 덩어리를 무작위 시각에 뿌린다"""
    n = int(SR * seconds)
    out = np.zeros(n)
    clap_len = int(SR * 0.03)
    shape = np.exp(-np.arange(clap_len) / (SR * 0.006))
    count = int(density * (seconds - start))
    for _ in range(count):
        at = start + (seconds - start) * rng.random() ** 0.7
        i = int(SR * at)
        if i + clap_len >= n:
            continue
        ramp = min(1, (at - start) / rise)
        out[i : i + clap_len] += rng.standard_normal(clap_len) * shape * rng.uniform(0.3, 1) * ramp
    return spectral_filter(out, lambda f: resonance(f, 1600, 2600) + 0.3 * resonance(f, 4000, 3000))


def stadium_bed(seconds: float, curve: np.ndarray) -> np.ndarray:
    """멀리서 들리는 수만 명의 웅성거림 (저음 위주의 넓은 잡음)"""
    bed = spectral_filter(rng.standard_normal(int(SR * seconds)), lambda f: highpass(f, 70) / (1 + (f / 900) ** 2))
    bed /= np.max(np.abs(bed))
    return bed * curve


def normalize(x: np.ndarray) -> np.ndarray:
    return x / (np.max(np.abs(x)) + 1e-9)


def goal_roar() -> np.ndarray:
    seconds = 5.0
    n = int(SR * seconds)
    t = t_axis(seconds)

    # 함성 곡선: 웅성 → 0.15초부터 폭발 → 2.5초 정점 유지 → 서서히 잦아듦
    curve = 0.12 + 0.88 * np.clip((t - 0.15) / 0.5, 0, 1) ** 0.6 * np.clip((seconds - t) / 2.2, 0, 1)
    curve *= 1 + 0.08 * smooth_noise(n, 3)

    def onset():
        return 0.12 + rng.exponential(0.25)

    def length():
        return rng.uniform(1.8, 4.2)

    def glide(x):
        return 0.18 * np.minimum(1, x * 4) - 0.1 * x  # 소리 지르며 음이 올라갔다가 살짝 내려감

    def loud():
        return rng.uniform(0.3, 1.0)

    yell_a = vowel_filter(crowd_voices(seconds, 220, onset, length, glide, loud), "a")
    yell_e = vowel_filter(crowd_voices(seconds, 90, onset, length, glide, loud), "e")
    voices = normalize(yell_a + 0.6 * yell_e)

    mix = 0.75 * voices + 0.35 * stadium_bed(seconds, curve) + 0.3 * normalize(claps(seconds, 0.6, 900))
    return fade(reverb(mix * curve, 1.8, 0.4, brightness=5000), 0.01, 0.6)


def save_gasp() -> np.ndarray:
    seconds = 3.6
    n = int(SR * seconds)
    t = t_axis(seconds)

    # "오오오!" 탄성 (짧게 몰렸다가 음이 내려감) → 박수로 이어짐
    curve = 0.15 + 0.85 * np.clip(t / 0.2, 0, 1) * np.clip((2.6 - t) / 1.4, 0, 1)
    curve = np.maximum(curve, 0.15) * (1 + 0.06 * smooth_noise(n, 3))

    def onset():
        return rng.exponential(0.08)

    def length():
        return rng.uniform(0.9, 1.8)

    def glide(x):
        return 0.12 * np.minimum(1, x * 6) - 0.28 * x  # "오오~" 올라갔다 실망하며 내려감

    def loud():
        return rng.uniform(0.3, 1.0)

    ooh = normalize(vowel_filter(crowd_voices(seconds, 260, onset, length, glide, loud), "o"))
    clap = normalize(claps(seconds, 0.9, 1100, rise=0.6)) * np.clip((t - 0.9) / 0.4, 0, 1) * np.clip((seconds - t) / 1.2, 0, 1)

    mix = 0.8 * ooh * curve + 0.3 * stadium_bed(seconds, curve * 0.7) + 0.45 * clap
    return fade(reverb(mix, 1.6, 0.38, brightness=5000), 0.01, 0.5)


if __name__ == "__main__":
    print("효과음 만드는 중…")
    save_mp3("whistle-kickoff.mp3", whistle_pattern([(0.9, 1.0)], 0.0), peak_db=-3)
    save_mp3("whistle-halftime.mp3", whistle_pattern([(0.4, 0.95), (1.0, 1.0)], 0.18), peak_db=-3)
    save_mp3("whistle-fulltime.mp3", whistle_pattern([(0.32, 0.95), (0.32, 0.95), (1.3, 1.0)], 0.16), peak_db=-3)
    save_mp3("crowd-goal.mp3", goal_roar())
    save_mp3("crowd-save.mp3", save_gasp())
    print("완료 →", OUT)
