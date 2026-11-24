import { josa as j } from '../utils/josa';
import type { TacticKey } from './tactics';
import type { Player } from './types';

// ─────────────────────────────────────────────
// 오프라인 엔진 해설 문장 모음 (한국어 + 영어 + 인도네시아어)
//
// - 상황별로 문장 틀을 여러 개 준비하고, 같은 경기에서
//   최근에 쓴 문장은 피해서 고른다 (Commentator.pick).
// - 문장 하나는 { ko, en, id } 묶음이라서 같은 장면을 세 언어로 함께 만든다.
//   (고르는 방식은 문장 개수만 보므로 한국어 문장·난수 순서는 예전과 같다)
// - 골 장면은 "득점 방식(선수 능력치)" + "경기 상황(동점·역전 등)"을
//   조합해서 만든다.
// ─────────────────────────────────────────────

type Rng = () => number;

/** 같은 장면의 한국어(ko)·영어(en)·인도네시아어(id) 해설 */
export interface Localized {
  ko: string;
  en: string;
  id: string;
}

type Text<V> = (v: V) => string;
type Line<V> = (v: V) => Localized;

/** 문장 틀을 짧게 쓰기 위한 도우미: say(한국어, 영어, 인도네시아어) */
const say = <V,>(ko: Text<V>, en: Text<V>, id: Text<V>): Line<V> => (v) => ({ ko: ko(v), en: en(v), id: id(v) });

/** 변수 없는 짧은 외침 */
const shout = (ko: string, en: string, id: string): Line<unknown> => () => ({ ko, en, id });

/** 여러 조각을 언어별로 이어 붙인다 */
function joinLocalized(parts: Localized[], sep = ' '): Localized {
  const join = (lang: keyof Localized) => parts.map((p) => p[lang]).filter(Boolean).join(sep);
  return { ko: join('ko'), en: join('en'), id: join('id') };
}

/** 같은 문장이 연달아 나오지 않게 기억하면서 고르는 해설자 */
export class Commentator {
  private recent = new Map<string, number[]>();

  constructor(private rng: Rng) {}

  pick<V, R>(category: string, lines: ((v: V) => R)[], v: V): R {
    const used = this.recent.get(category) ?? [];
    const fresh = lines.map((_, i) => i).filter((i) => !used.includes(i));
    const pool = fresh.length ? fresh : lines.map((_, i) => i);
    const index = pool[Math.floor(this.rng() * pool.length)];

    // 문장 수의 절반까지는 다시 쓰지 않는다
    const memory = Math.max(1, Math.floor(lines.length / 2));
    this.recent.set(category, [...used, index].slice(-memory));
    return lines[index](v);
  }

  chance(p: number): boolean {
    return this.rng() < p;
  }
}

// ─────────────── 골: 득점 방식 ───────────────

export type GoalStyle = 'longshot' | 'solo' | 'counter' | 'header' | 'finesse' | 'tapin' | 'volley' | 'penalty';

/** 선수 능력치로 그럴듯한 득점 방식을 고른다 */
export function chooseGoalStyle(shooter: Player, rng: Rng): GoalStyle {
  const s = shooter.stats;
  const weights: [GoalStyle, number][] = [
    ['longshot', s.shooting * 1.2],
    ['solo', s.dribbling],
    ['counter', s.pace],
    ['header', s.physical * 0.9],
    ['finesse', (s.shooting + s.dribbling) / 2],
    ['tapin', 60],
    ['volley', (s.shooting + s.physical) / 2 * 0.8],
    ['penalty', 55],
  ];
  // 능력치가 높을수록 그 방식이 나올 확률이 커진다 (제곱으로 차이를 키움)
  const total = weights.reduce((a, [, w]) => a + w * w, 0);
  let r = rng() * total;
  for (const [style, w] of weights) {
    r -= w * w;
    if (r <= 0) return style;
  }
  return 'tapin';
}

interface GoalVars {
  s: string; // 득점자
  a?: string; // 도움
  k?: string; // 상대 골키퍼
  team: string;
}

const GOAL_LINES: Record<GoalStyle, Line<GoalVars>[]> = {
  longshot: [
    say((v) => `${j(v.s, '이/가')} 먼 거리에서 그대로 때립니다! 대포알 중거리 슛이 골망 구석에 꽂혀요!`,
        (v) => `${v.s} hits it from distance! A thunderbolt into the corner of the net!`,
        (v) => `${v.s} menembak dari jarak jauh! Tendangan geledek masuk ke pojok gawang!`),
    say((v) => `페널티 박스 밖에서 ${v.s}의 캐논 슈팅! 골키퍼가 손도 못 대요!`,
        (v) => `A cannon of a shot from ${v.s} outside the box! The keeper couldn't touch it!`,
        (v) => `Tendangan meriam ${v.s} dari luar kotak penalti! Kiper tak bisa menyentuhnya!`),
    say((v) => `${v.s}, 아무도 예상 못 한 30미터 장거리 슛! 공이 쭉 날아가 골!`,
        (v) => `${v.s} tries it from 30 meters out! Nobody saw that coming, and it flies in!`,
        (v) => `${v.s} mencoba dari jarak 30 meter! Tak ada yang menyangka, dan bola masuk!`),
    say((v) => `튀어나온 공을 ${j(v.s, '이/가')} 논스톱 발리로! 이건 정말 그림 같은 골이에요!`,
        (v) => `${v.s} meets the loose ball with a first-time volley! What a picture-perfect goal!`,
        (v) => `${v.s} menyambar bola liar dengan voli langsung! Gol yang indah sekali!`),
    say((v) => `${j(v.s, '이/가')} 수비 틈 사이로 낮게 깔아 찬 중거리 슛! 골키퍼가 늦었어요!`, (v) => `${v.s} drills a low strike through a gap in the defense! The keeper was too late!`, (v) => `${v.s} melepaskan tembakan mendatar di sela pertahanan! Kiper terlambat!`),
    say((v) => `${v.s}의 무회전 슈팅! 공이 흔들리며 날아가 골망을 흔듭니다!`, (v) => `A knuckleball from ${v.s}! It wobbles all the way into the net!`, (v) => `Tendangan tanpa putaran dari ${v.s}! Bola bergoyang dan masuk ke gawang!`),
    say((v) => `한 번 툭 치고 바로 슈팅! ${v.s}의 중거리가 골대 상단에 꽂혀요!`, (v) => `One touch to set and bang! ${v.s} buries it in the top corner!`, (v) => `Satu sentuhan lalu tembak! Tembakan jarak jauh ${v.s} menghujam pojok atas!`),
  ],
  solo: [
    say((v) => `${v.s}의 드리블 쇼! 수비수 두 명을 제치고 마무리까지 완벽해요!`,
        (v) => `The ${v.s} dribbling show! Past two defenders and a perfect finish!`,
        (v) => `Pertunjukan dribel ${v.s}! Melewati dua bek dan penyelesaian yang sempurna!`),
    say((v) => `${j(v.s, '이/가')} 공을 몰고 혼자서 끝까지! 개인기로 만든 멋진 골!`,
        (v) => `${v.s} carries it all the way alone! A brilliant solo goal!`,
        (v) => `${v.s} membawa bola sendirian sampai akhir! Gol solo yang hebat!`),
    say((v) => `발바닥 터치, 헛다리 짚기! ${j(v.s, '이/가')} 수비를 흔들고 골을 넣습니다!`,
        (v) => `A sole roll, a step-over! ${v.s} shakes off the defense and scores!`,
        (v) => `Seret bola, gerakan step-over! ${v.s} mengecoh pertahanan dan mencetak gol!`),
    say((v) => `${v.s}, 골키퍼까지 가볍게 제치고 빈 골대에 쏙!`,
        (v) => `${v.s} rounds the keeper too and slots it into the empty net!`,
        (v) => `${v.s} melewati kiper juga dan menceploskan bola ke gawang kosong!`),
    say((v) => `${v.s}의 마르세유 턴! 빙글 돌아 수비를 벗겨내고 골!`, (v) => `A Marseille turn from ${v.s}! Spins away from the defender and scores!`, (v) => `Putaran Marseille dari ${v.s}! Berputar melewati bek dan mencetak gol!`),
    say((v) => `측면에서 안으로 파고든 ${v.s}, 세 명 사이를 뚫고 마무리!`, (v) => `${v.s} cuts in from the wing, slices through three players and finishes!`, (v) => `${v.s} menusuk dari sayap, menembus tiga pemain dan menyelesaikan peluang!`),
    say((v) => `${j(v.s, '이/가')} 공을 발에 붙이고 달립니다! 아무도 못 막아요! 골!`, (v) => `${v.s} runs with the ball glued to the feet! Nobody can stop it! Goal!`, (v) => `${v.s} berlari dengan bola lengket di kaki! Tak ada yang bisa menghentikan! Gol!`),
  ],
  counter: [
    say((v) => `번개 같은 역습! ${j(v.s, '이/가')} 단숨에 달려가 골키퍼와 1대1, 골!`,
        (v) => `A lightning counter-attack! ${v.s} races clear, one on one with the keeper, goal!`,
        (v) => `Serangan balik secepat kilat! ${v.s} lolos, satu lawan satu dengan kiper, gol!`),
    say((v) => `${v.s}의 폭풍 질주! 아무도 따라잡지 못하고 그대로 골!`,
        (v) => `${v.s} storms forward! Nobody can catch up, and it's in!`,
        (v) => `${v.s} berlari kencang! Tak ada yang bisa mengejar, dan gol!`),
    say((v) => `수비 뒷공간을 파고든 ${v.s}! 빠른 발로 만든 골이에요!`,
        (v) => `${v.s} gets in behind the defense! A goal made by pure pace!`,
        (v) => `${v.s} menerobos ke belakang pertahanan! Gol berkat kecepatan!`),
    say((v) => `우리 진영에서 시작된 역습이 ${v.s}의 발끝에서 골로 끝납니다!`,
        (v) => `A counter from deep finishes at the feet of ${v.s}! Goal!`,
        (v) => `Serangan balik dari belakang berakhir di kaki ${v.s}! Gol!`),
    say((v) => `상대 코너킥이 끝나자마자 역습! ${j(v.s, '이/가')} 70미터를 달려 골!`, (v) => `Straight from the opponents' corner, a counter! ${v.s} runs 70 meters and scores!`, (v) => `Langsung setelah sepak pojok lawan, serangan balik! ${v.s} berlari 70 meter dan mencetak gol!`),
    say((v) => `패스 세 번 만에 골문 앞! ${v.s}의 침착한 마무리, 교과서 같은 역습!`, (v) => `Three passes and they're in front of goal! A calm finish from ${v.s}, a textbook counter!`, (v) => `Tiga umpan dan sudah di depan gawang! Penyelesaian tenang ${v.s}, serangan balik sempurna!`),
    say((v) => `${j(v.s, '이/가')} 수비수를 속도로 따돌립니다! 그대로 골망을 흔들어요!`, (v) => `${v.s} leaves the defender for dead with pure speed! Into the net it goes!`, (v) => `${v.s} meninggalkan bek dengan kecepatan! Bola langsung menggetarkan jala!`),
  ],
  header: [
    say((v) => `높이 뜬 크로스! ${j(v.s, '이/가')} 솟구쳐 오르며 헤더 골!`,
        (v) => `A high cross! ${v.s} rises above everyone and heads it in!`,
        (v) => `Umpan silang tinggi! ${v.s} melompat paling tinggi dan menyundul masuk!`),
    say((v) => `코너킥 상황에서 ${v.s}의 강력한 헤딩! 골대 안으로 꽂힙니다!`,
        (v) => `From the corner, a powerful header by ${v.s}! It flies into the net!`,
        (v) => `Dari tendangan sudut, sundulan keras ${v.s}! Bola melesat ke gawang!`),
    say((v) => `${v.s}, 수비수보다 한 뼘 더 높이 뛰어 머리로 골을 만들어요!`,
        (v) => `${v.s} jumps higher than the defender and nods it home!`,
        (v) => `${v.s} melompat lebih tinggi dari bek dan menyundul bola masuk!`),
    say((v) => `날아오는 공을 ${j(v.s, '이/가')} 다이빙 헤더로! 정말 용감한 골이에요!`,
        (v) => `A diving header from ${v.s}! What a brave goal!`,
        (v) => `Sundulan sambil terbang dari ${v.s}! Gol yang sangat berani!`),
    say((v) => `프리킥이 올라오고… ${v.s}의 머리에 정확히! 골대 구석으로 들어가요!`, (v) => `The free kick comes in... right onto the head of ${v.s}! Into the corner!`, (v) => `Tendangan bebas melayang... tepat di kepala ${v.s}! Masuk ke pojok gawang!`),
    say((v) => `${j(v.s, '이/가')} 뒤로 돌아 들어가며 백헤더! 골키퍼가 꼼짝 못 해요!`, (v) => `${v.s} flicks a back-header! The keeper is rooted to the spot!`, (v) => `${v.s} menyundul ke belakang! Kiper hanya bisa terpaku!`),
    say((v) => `니어포스트로 달려든 ${v.s}, 살짝 방향만 바꾸는 헤더로 골!`, (v) => `${v.s} darts to the near post and glances a header in!`, (v) => `${v.s} berlari ke tiang dekat dan menyundul tipis ke gawang!`),
  ],
  finesse: [
    say((v) => `${v.s}의 감아차기! 공이 휘어지며 골대 구석으로 빨려 들어가요!`,
        (v) => `${v.s} curls it! The ball bends right into the corner!`,
        (v) => `Tendangan melengkung ${v.s}! Bola berbelok masuk ke pojok gawang!`),
    say((v) => `골키퍼 키를 넘기는 ${v.s}의 칩슛! 살짝 띄운 공이 그대로 골!`,
        (v) => `A delicate chip from ${v.s} over the keeper! It drops in!`,
        (v) => `Cungkilan halus ${v.s} melewati kiper! Bola jatuh masuk!`),
    say((v) => `${j(v.s, '이/가')} 침착하게 반대쪽 구석으로 밀어 넣습니다! 깔끔한 마무리!`,
        (v) => `${v.s} calmly places it into the far corner! A clean finish!`,
        (v) => `${v.s} dengan tenang menempatkan bola ke pojok jauh! Penyelesaian yang rapi!`),
    say((v) => `${v.s}의 프리킥! 수비벽을 넘어 골대 안으로 휘어 들어갑니다!`,
        (v) => `A free kick from ${v.s}! Over the wall and curling into the net!`,
        (v) => `Tendangan bebas ${v.s}! Melewati pagar pemain dan melengkung masuk!`),
    say((v) => `${v.s}, 골키퍼가 나오는 걸 보고 살짝 띄웁니다! 여유가 넘쳐요!`, (v) => `${v.s} sees the keeper rushing out and lifts it over! So cool!`, (v) => `${v.s} melihat kiper maju dan mencungkil bola! Sangat tenang!`),
    say((v) => `아웃프런트로 감아 찬 ${v.s}의 슈팅! 공이 바깥으로 휘다 골대 안으로!`, (v) => `An outside-of-the-boot strike from ${v.s}! It bends out, then curls back in!`, (v) => `Tendangan kaki luar dari ${v.s}! Bola melengkung keluar lalu kembali masuk!`),
    say((v) => `${j(v.s, '이/가')} 먼 쪽 포스트를 보고 감아 찹니다! 완벽한 궤적!`, (v) => `${v.s} curls it toward the far post! A perfect trajectory!`, (v) => `${v.s} melengkungkan bola ke tiang jauh! Lintasan sempurna!`),
  ],
  tapin: [
    say((v) => `골문 앞 혼전! ${j(v.s, '이/가')} 가장 먼저 반응해 밀어 넣어요!`,
        (v) => `A scramble in front of goal! ${v.s} reacts first and pokes it in!`,
        (v) => `Kemelut di depan gawang! ${v.s} bereaksi paling cepat dan mendorong bola masuk!`),
    say((v) => `골키퍼가 쳐낸 공을 ${j(v.s, '이/가')} 놓치지 않고 골!`,
        (v) => `The keeper parries it, but ${v.s} is there to finish!`,
        (v) => `Kiper menepis bola, tapi ${v.s} sudah siap menyelesaikannya!`),
    say((v) => `${v.s}, 빈 골대에 가볍게 톡! 자리를 잘 잡고 있었어요!`,
        (v) => `${v.s} taps it into the empty net! Great positioning!`,
        (v) => `${v.s} menyontek bola ke gawang kosong! Posisinya tepat sekali!`),
    say((v) => `${v.s}의 집중력! 끝까지 공을 쫓아가 골로 만듭니다!`,
        (v) => `Great focus from ${v.s}! Chased it to the end and scored!`,
        (v) => `Konsentrasi luar biasa dari ${v.s}! Mengejar bola sampai akhir dan mencetak gol!`),
    say((v) => `골대 맞고 나온 공을 ${j(v.s, '이/가')} 다시 밀어 넣어요! 끈질긴 골!`, (v) => `Off the post, and ${v.s} pokes in the rebound! Never giving up!`, (v) => `Bola memantul dari tiang, ${v.s} menyambar bola muntah! Gol pantang menyerah!`),
    say((v) => `낮게 깔린 크로스, ${j(v.s, '이/가')} 발만 갖다 댑니다! 골!`, (v) => `A low cross, and ${v.s} just sticks out a foot! Goal!`, (v) => `Umpan silang mendatar, ${v.s} tinggal menyodorkan kaki! Gol!`),
    say((v) => `수비수 발에 맞고 굴절된 공, ${v.s} 앞에 떨어져요! 놓치지 않습니다!`, (v) => `A deflection off a defender drops right in front of ${v.s}! No mistake!`, (v) => `Bola membentur kaki bek dan jatuh di depan ${v.s}! Tidak disia-siakan!`),
  ],
  volley: [
    say((v) => `떨어지는 공을 ${j(v.s, '이/가')} 그대로 발리 슛! 골망이 출렁여요!`, (v) => `${v.s} hits the dropping ball on the volley! The net bulges!`, (v) => `${v.s} menyambar bola jatuh dengan voli! Jala bergetar!`),
    say((v) => `${v.s}의 시저스킥! 몸을 비틀며 찬 공이 골대 안으로!`, (v) => `A scissor kick from ${v.s}! Twisting in the air, and it's in!`, (v) => `Tendangan gunting dari ${v.s}! Memutar badan di udara, dan masuk!`),
    say((v) => `오버헤드킥!!! ${v.s}, 이게 정말 들어갑니다! 올해의 골 후보!`, (v) => `AN OVERHEAD KICK!!! ${v.s}, that actually goes in! Goal of the season contender!`, (v) => `TENDANGAN SALTO!!! ${v.s}, bola benar-benar masuk! Kandidat gol terbaik musim ini!`),
    say((v) => `크로스를 가슴으로 받지도 않고 ${j(v.s, '이/가')} 논스톱 하프발리! 골!`, (v) => `No touch needed, ${v.s} meets the cross with a half-volley! Goal!`, (v) => `Tanpa kontrol, ${v.s} menyambut umpan silang dengan setengah voli! Gol!`),
    say((v) => `${v.s}의 발등에 정확히 얹힌 발리! 골키퍼는 보기만 했어요!`, (v) => `A perfectly struck volley from ${v.s}! The keeper could only watch!`, (v) => `Voli yang dieksekusi sempurna oleh ${v.s}! Kiper hanya bisa melihat!`),
  ],
  penalty: [
    say((v) => `페널티킥! ${j(v.s, '이/가')} 침착하게 골키퍼 반대 방향으로 차 넣습니다!`, (v) => `Penalty! ${v.s} calmly sends the keeper the wrong way!`, (v) => `Penalti! ${v.s} dengan tenang mengecoh arah kiper!`),
    say((v) => `${v.s}의 파넨카킥! 가운데로 살짝 띄워 골! 배짱이 대단해요!`, (v) => `A Panenka from ${v.s}! Chipped down the middle! What nerve!`, (v) => `Tendangan Panenka dari ${v.s}! Dicungkil ke tengah! Nyalinya luar biasa!`),
    say((v) => `박스 안 반칙으로 얻은 페널티킥, ${j(v.s, '이/가')} 구석으로 강하게! 골!`, (v) => `A penalty for a foul in the box, and ${v.s} smashes it into the corner! Goal!`, (v) => `Penalti karena pelanggaran di kotak, ${v.s} menghantamkan bola ke pojok! Gol!`),
    say((v) => `${j(v.k ?? '골키퍼', '이/가')} 방향은 맞혔지만 ${v.s}의 페널티킥이 더 빨랐어요!`, (v) => `${v.k ?? 'The keeper'} guessed right, but the penalty from ${v.s} was too quick!`, (v) => `${v.k ?? 'Kiper'} menebak arah dengan benar, tapi penalti ${v.s} terlalu cepat!`),
    say((v) => `숨 막히는 순간… ${v.s}, 페널티킥 성공! 골대 위쪽 구석이에요!`, (v) => `A breathless moment... ${v.s} scores the penalty! Top corner!`, (v) => `Momen menegangkan... ${v.s} sukses mengeksekusi penalti! Pojok atas!`),
  ],
};

const ASSIST_LINES: Line<GoalVars>[] = [
  say((v) => `${v.a}의 킬패스가 빛났어요!`, (v) => `What a killer pass from ${v.a}!`, (v) => `Umpan mematikan dari ${v.a}!`),
  say((v) => `${v.a}의 크로스가 정확했어요!`, (v) => `A pinpoint cross from ${v.a}!`, (v) => `Umpan silang akurat dari ${v.a}!`),
  say((v) => `${j(v.a ?? '', '과/와')} ${v.s}의 환상 호흡!`, (v) => `Fantastic teamwork between ${v.a} and ${v.s}!`, (v) => `Kerja sama luar biasa antara ${v.a} dan ${v.s}!`),
  say((v) => `도움은 ${v.a}! 눈이 좋은 패스였어요.`, (v) => `The assist goes to ${v.a}! Great vision.`, (v) => `Assist dari ${v.a}! Visi yang hebat.`),
  say((v) => `${v.a}의 한 번에 넘겨준 롱패스가 시작이었어요!`, (v) => `It all started with a long ball from ${v.a}!`, (v) => `Semua berawal dari umpan panjang ${v.a}!`),
  say((v) => `${j(v.a ?? '', '이/가')} 수비 사이로 찔러준 패스, 완벽했어요!`, (v) => `${v.a} threaded it through the defense, perfect!`, (v) => `${v.a} menyelipkan umpan di sela pertahanan, sempurna!`),
  say((v) => `${v.a}의 힐패스가 수비를 완전히 속였어요!`, (v) => `A backheel from ${v.a} completely fooled the defense!`, (v) => `Umpan tumit ${v.a} benar-benar mengecoh pertahanan!`),
  say((v) => `${j(v.a ?? '', '이/가')} 측면을 뚫고 올려준 컷백이 결정적이었어요!`, (v) => `The cutback from ${v.a} after beating the full-back was decisive!`, (v) => `Umpan tarik ${v.a} setelah menembus sayap sangat menentukan!`),
  say((v) => `${v.a}, 오늘 벌써 좋은 패스를 몇 번째 뿌리는지 몰라요!`, (v) => `${v.a} has been spraying great passes all day!`, (v) => `${v.a} terus mengirim umpan-umpan bagus sepanjang laga!`),
  say((v) => `${j(v.a ?? '', '이/가')} 욕심내지 않고 내준 패스, 팀워크의 승리예요!`, (v) => `${v.a} unselfishly squares it, a win for teamwork!`, (v) => `${v.a} tidak egois dan mengoper, kemenangan kerja sama tim!`),
];

// ─────────────── 골: 경기 상황 ───────────────

export type GoalSituation =
  | 'opener' // 경기 첫 골
  | 'equalizer' // 동점골
  | 'goAhead' // 동점에서 앞서가는 골
  | 'comeback' // 지고 있다가 역전
  | 'extend' // 점수 차 벌리기
  | 'consolation' // 지는 팀이 한 골 따라감
  | 'none';

export function goalSituation(before: { mine: number; theirs: number }): GoalSituation {
  const { mine, theirs } = before;
  const after = mine + 1;
  if (mine === 0 && theirs === 0) return 'opener';
  if (after === theirs) return 'equalizer';
  if (mine === theirs) return 'goAhead';
  if (mine < theirs && after > theirs) return 'comeback';
  if (mine > theirs) return 'extend';
  if (after < theirs) return 'consolation';
  return 'none';
}

const SITUATION_LINES: Record<GoalSituation, Line<GoalVars & { score: string }>[]> = {
  opener: [
    say((v) => `오늘 경기의 첫 골! ${j(v.team, '이/가')} 먼저 웃습니다. (${v.score})`,
        (v) => `The first goal of the game! ${v.team} strike first. (${v.score})`,
        (v) => `Gol pertama pertandingan! ${v.team} unggul lebih dulu. (${v.score})`),
    say((v) => `0의 균형이 깨졌어요! ${v.team} 선제골! (${v.score})`,
        (v) => `The deadlock is broken! ${v.team} take the lead! (${v.score})`,
        (v) => `Kebuntuan pecah! ${v.team} memimpin! (${v.score})`),
    say((v) => `기다리던 첫 골의 주인공은 ${v.s}! (${v.score})`,
        (v) => `The long-awaited first goal belongs to ${v.s}! (${v.score})`,
        (v) => `Gol pertama yang dinanti dicetak oleh ${v.s}! (${v.score})`),
    say((v) => `드디어 첫 골이 나왔어요! 이제 경기가 뜨거워집니다! (${v.score})`, (v) => `Finally, the first goal! Now this game is heating up! (${v.score})`, (v) => `Akhirnya gol pertama! Sekarang laga makin panas! (${v.score})`),
    say((v) => `선제골은 언제나 중요하죠! ${v.team}, 기분 좋은 출발! (${v.score})`, (v) => `The first goal always matters! A great start for ${v.team}! (${v.score})`, (v) => `Gol pertama selalu penting! Awal yang bagus untuk ${v.team}! (${v.score})`),
  ],
  equalizer: [
    say((v) => `동점골!! 경기가 다시 원점으로 돌아갑니다! (${v.score})`,
        (v) => `The equalizer!! We're all square again! (${v.score})`,
        (v) => `Gol penyama!! Skor kembali imbang! (${v.score})`),
    say((v) => `${j(v.team, '이/가')} 끝까지 포기하지 않았어요! 따라붙는 동점골! (${v.score})`,
        (v) => `${v.team} never gave up! They pull level! (${v.score})`,
        (v) => `${v.team} tidak pernah menyerah! Mereka menyamakan kedudukan! (${v.score})`),
    say((v) => `균형을 맞추는 귀중한 한 방! 이제 승부는 다시 시작이에요! (${v.score})`,
        (v) => `A precious leveller! It's a brand-new game! (${v.score})`,
        (v) => `Gol penyama yang berharga! Pertandingan dimulai lagi dari awal! (${v.score})`),
    say((v) => `${v.s}의 동점골! 벤치가 모두 뛰어나와 기뻐해요! (${v.score})`, (v) => `The equalizer from ${v.s}! The whole bench runs out to celebrate! (${v.score})`, (v) => `Gol penyeimbang dari ${v.s}! Seluruh bangku cadangan berlari merayakan! (${v.score})`),
    say((v) => `다시 팽팽해졌어요! 어느 팀이 웃을지 아무도 몰라요! (${v.score})`, (v) => `All square again! Nobody knows who will have the last laugh! (${v.score})`, (v) => `Imbang lagi! Tak ada yang tahu siapa yang akan tersenyum! (${v.score})`),
  ],
  goAhead: [
    say((v) => `${j(v.team, '이/가')} 다시 앞서 나갑니다! (${v.score})`,
        (v) => `${v.team} go back in front! (${v.score})`,
        (v) => `${v.team} kembali memimpin! (${v.score})`),
    say((v) => `팽팽하던 승부를 깨는 골! ${v.team} 리드! (${v.score})`,
        (v) => `A goal that breaks the tension! ${v.team} lead! (${v.score})`,
        (v) => `Gol yang memecah ketegangan! ${v.team} unggul! (${v.score})`),
    say((v) => `중요한 순간에 터진 골! ${j(v.team, '이/가')} 한 발 앞서요! (${v.score})`,
        (v) => `A goal at a crucial moment! ${v.team} edge ahead! (${v.score})`,
        (v) => `Gol di saat yang penting! ${v.team} selangkah di depan! (${v.score})`),
    say((v) => `${v.s}, 균형을 깨뜨립니다! ${v.team}의 리드! (${v.score})`, (v) => `${v.s} breaks the deadlock! ${v.team} lead! (${v.score})`, (v) => `${v.s} memecah kebuntuan! ${v.team} unggul! (${v.score})`),
  ],
  comeback: [
    say((v) => `역전!!! ${j(v.team, '이/가')} 경기를 뒤집었어요! (${v.score})`,
        (v) => `The comeback!!! ${v.team} have turned it around! (${v.score})`,
        (v) => `Comeback!!! ${v.team} membalikkan keadaan! (${v.score})`),
    say((v) => `믿을 수 없는 역전골! 관중석이 들썩들썩! (${v.score})`,
        (v) => `An unbelievable go-ahead goal! The stands are rocking! (${v.score})`,
        (v) => `Gol pembalik yang luar biasa! Tribun penonton bergemuruh! (${v.score})`),
    say((v) => `지고 있던 ${j(v.team, '이/가')} 마침내 앞서갑니다! 대역전 드라마! (${v.score})`,
        (v) => `${v.team} were behind, and now they lead! What a drama! (${v.score})`,
        (v) => `${v.team} tadinya tertinggal, kini memimpin! Drama yang hebat! (${v.score})`),
    say((v) => `${v.s}의 역전골! 경기장이 떠나갈 것 같아요! (${v.score})`, (v) => `${v.s} completes the turnaround! The stadium is shaking! (${v.score})`, (v) => `${v.s} membalikkan keadaan! Stadion seperti mau runtuh! (${v.score})`),
  ],
  extend: [
    say((v) => `점수 차를 벌리는 추가골! ${j(v.team, '이/가')} 신났어요! (${v.score})`,
        (v) => `Another one to stretch the lead! ${v.team} are flying! (${v.score})`,
        (v) => `Gol tambahan memperlebar keunggulan! ${v.team} sedang di atas angin! (${v.score})`),
    say((v) => `${v.team}, 멈추지 않는 골 행진! (${v.score})`,
        (v) => `${v.team} just can't stop scoring! (${v.score})`,
        (v) => `${v.team} terus mencetak gol tanpa henti! (${v.score})`),
    say((v) => `쐐기를 박는 골일까요? ${v.team} 달아납니다! (${v.score})`,
        (v) => `Is that the clincher? ${v.team} pull away! (${v.score})`,
        (v) => `Apakah ini gol penentu? ${v.team} makin menjauh! (${v.score})`),
    say((v) => `${v.team}, 여유가 생겼어요! 한 골 더 도망갑니다! (${v.score})`, (v) => `${v.team} can breathe now! Another goal to stretch the lead! (${v.score})`, (v) => `${v.team} kini lebih tenang! Satu gol lagi memperlebar jarak! (${v.score})`),
  ],
  consolation: [
    say((v) => `${j(v.team, '이/가')} 한 골 따라갑니다! 아직 포기하긴 일러요! (${v.score})`,
        (v) => `${v.team} pull one back! It's not over yet! (${v.score})`,
        (v) => `${v.team} memperkecil ketertinggalan! Belum berakhir! (${v.score})`),
    say((v) => `추격의 불씨를 살리는 골! ${v.team} 힘내라! (${v.score})`,
        (v) => `A goal that keeps hope alive! Come on, ${v.team}! (${v.score})`,
        (v) => `Gol yang menjaga harapan! Ayo, ${v.team}! (${v.score})`),
    say((v) => `만회골! ${j(v.team, '이/가')} 다시 힘을 냅니다! (${v.score})`,
        (v) => `A consolation goal! ${v.team} find new energy! (${v.score})`,
        (v) => `Gol hiburan! ${v.team} kembali bersemangat! (${v.score})`),
    say((v) => `${v.s}의 골로 점수 차가 줄었어요! 아직 시간은 있어요! (${v.score})`, (v) => `${v.s} narrows the gap! There's still time! (${v.score})`, (v) => `Gol ${v.s} memperkecil jarak! Masih ada waktu! (${v.score})`),
  ],
  none: [say((v) => `(${v.score})`, (v) => `(${v.score})`, (v) => `(${v.score})`)],
};

const MULTI_GOAL_LINES: Record<2 | 3, Line<GoalVars>[]> = {
  2: [
    say((v) => `${v.s}의 오늘 두 번째 골! 멀티골이에요!`, (v) => `That's ${v.s}'s second goal today! A brace!`, (v) => `Gol kedua ${v.s} hari ini! Brace!`),
    say((v) => `${v.s}, 벌써 두 골째! 오늘 컨디션 최고예요!`, (v) => `${v.s} already has two! What a day!`, (v) => `${v.s} sudah dua gol! Hari yang hebat!`),
  ],
  3: [
    say((v) => `해트트릭!!! ${j(v.s, '이/가')} 혼자서 세 골을 넣었어요! 🎩`, (v) => `HAT-TRICK!!! ${v.s} has scored three goals! 🎩`, (v) => `HAT-TRICK!!! ${v.s} mencetak tiga gol! 🎩`),
    say((v) => `${v.s}의 해트트릭 완성! 오늘의 주인공은 바로 ${v.s}!`, (v) => `Hat-trick complete for ${v.s}! The star of the day is ${v.s}!`, (v) => `Hat-trick lengkap untuk ${v.s}! Bintang hari ini adalah ${v.s}!`),
  ],
};

export interface GoalContext {
  shooter: Player;
  assist?: Player;
  keeper?: Player;
  team: string;
  style: GoalStyle;
  situation: GoalSituation;
  /** 이 골 포함 득점자의 오늘 골 수 */
  scorerGoals: number;
  minute: number;
  scoreText: string;
}

export function goalText(c: Commentator, g: GoalContext): Localized {
  const v = { s: g.shooter.name, a: g.assist?.name, k: g.keeper?.name, team: g.team, score: g.scoreText };
  const parts: Localized[] = [];

  // 시간대 감탄사
  if (g.minute <= 5) parts.push(c.pick('goal-early', EARLY_GOAL, v));
  else if (g.minute >= 85) parts.push(c.pick('goal-late', LATE_GOAL, v));
  else parts.push(c.pick('goal-shout', GOAL_SHOUT, v));

  parts.push(c.pick(`goal-${g.style}`, GOAL_LINES[g.style], v));
  if (g.assist && g.style !== 'solo' && c.chance(0.7)) parts.push(c.pick('assist', ASSIST_LINES, v));

  if (g.scorerGoals >= 3) parts.push(c.pick('hattrick', MULTI_GOAL_LINES[3], v));
  else if (g.scorerGoals === 2) parts.push(c.pick('brace', MULTI_GOAL_LINES[2], v));

  parts.push(c.pick(`sit-${g.situation}`, SITUATION_LINES[g.situation], v));
  return joinLocalized(parts);
}

const GOAL_SHOUT: Line<unknown>[] = [
  shout('골!!', 'GOAL!!', 'GOL!!'),
  shout('고오오올!', 'GOOOAL!', 'GOOOL!'),
  shout('들어갔어요!', "It's in!", 'Masuk!'),
  shout('와아아!', 'WOW!', 'Wow!'),
  shout('골인!', 'Goal!', 'Gol!'),
  shout('해냈어요!', 'They did it!', 'Berhasil!'),
  shout(`골이에요 골!`, `It's a goal!`, `Gol, gol!`),
  shout(`터졌습니다!`, `There it is!`, `Itu dia!`),
  shout(`그물이 출렁!`, `The net is rippling!`, `Jala bergetar!`),
  shout(`이야아아!`, `YESSS!`, `Yeaaah!`),
];
const EARLY_GOAL: Line<unknown>[] = [
  shout('경기 시작하자마자 골!', 'A goal right from the start!', 'Gol tepat setelah laga dimulai!'),
  shout('눈 깜짝할 새 터진 골!', 'A goal in the blink of an eye!', 'Gol dalam sekejap mata!'),
  shout(`자리에 앉기도 전에 골이 나왔어요!`, `Fans have barely taken their seats and it is a goal!`, `Penonton belum sempat duduk, sudah gol!`),
  shout(`킥오프 휘슬의 여운이 가시기도 전에 골!`, `The kickoff whistle is still echoing and it is a goal!`, `Peluit sepak mula masih terdengar, sudah gol!`),
];
const LATE_GOAL: Line<unknown>[] = [
  shout('경기 막판에 터진 골!', 'A late, late goal!', 'Gol di menit-menit akhir!'),
  shout('마지막까지 포기하지 않은 골!', 'They never gave up, and it pays off!', 'Pantang menyerah sampai akhir, dan berbuah gol!'),
  shout('종료 직전 극장골!', 'A dramatic last-gasp goal!', 'Gol dramatis jelang bubar!'),
  shout(`추가시간이 다가오는데 골!`, `Stoppage time is near, and they score!`, `Jelang waktu tambahan, gol!`),
  shout(`마지막 힘을 짜낸 골!`, `A goal squeezed out with the last of their energy!`, `Gol dengan sisa tenaga terakhir!`),
];

// ─────────────── 슈팅 / 선방 / 빗나감 ───────────────

interface ShotVars {
  s: string;
  k: string;
  d: string; // 상대 수비수
  team: string;
}

export const SHOT_ON_TARGET: Line<ShotVars>[] = [
  say((v) => `${v.s}의 날카로운 슈팅!`, (v) => `A sharp shot from ${v.s}!`, (v) => `Tembakan tajam dari ${v.s}!`),
  say((v) => `${j(v.s, '이/가')} 골문 구석을 노리고 강하게 찹니다!`, (v) => `${v.s} aims for the corner and strikes hard!`, (v) => `${v.s} mengincar pojok gawang dan menendang keras!`),
  say((v) => `${v.s}, 수비 사이로 낮게 깔리는 슈팅!`, (v) => `${v.s} fires a low shot through the defenders!`, (v) => `${v.s} melepaskan tembakan mendatar di sela para bek!`),
  say((v) => `${j(v.s, '이/가')} 가슴 트래핑 후 바로 슈팅!`, (v) => `${v.s} chests it down and shoots right away!`, (v) => `${v.s} mengontrol dengan dada lalu langsung menembak!`),
  say((v) => `기회를 잡은 ${v.s}, 힘껏 때립니다!`, (v) => `${v.s} gets the chance and hits it with everything!`, (v) => `${v.s} mendapat peluang dan menendang sekuat tenaga!`),
  say((v) => `${v.s}의 강력한 프리킥이 골문으로 향해요!`, (v) => `A powerful free kick from ${v.s} heads for goal!`, (v) => `Tendangan bebas keras ${v.s} mengarah ke gawang!`),
  say((v) => `${j(v.s, '이/가')} 수비를 등지고 돌아서며 슈팅!`, (v) => `${v.s} turns away from the defender and shoots!`, (v) => `${v.s} berbalik dari bek dan menembak!`),
  say((v) => `코너킥 혼전 속에서 ${v.s}의 슈팅!`, (v) => `A shot from ${v.s} in the scramble after the corner!`, (v) => `Tembakan ${v.s} di tengah kemelut sepak pojok!`),
  say((v) => `${v.s}의 감아차기가 골대 구석을 향해요!`, (v) => `${v.s} curls one toward the corner!`, (v) => `${v.s} melengkungkan bola ke pojok gawang!`),
  say((v) => `${j(v.s, '이/가')} 골키퍼와 1대1! 슈팅합니다!`, (v) => `${v.s} is one on one with the keeper! Shoots!`, (v) => `${v.s} satu lawan satu dengan kiper! Menembak!`),
  say((v) => `${v.s}, 바운드된 공을 그대로 발리 슈팅!`, (v) => `${v.s} volleys the bouncing ball!`, (v) => `${v.s} memvoli bola yang memantul!`),
  say((v) => `${j(v.s, '이/가')} 박스 안으로 파고들며 슈팅!`, (v) => `${v.s} drives into the box and shoots!`, (v) => `${v.s} menusuk ke kotak penalti dan menembak!`),
];

export const SAVE: Line<ShotVars>[] = [
  say((v) => `하지만 ${j(v.k, '이/가')} 몸을 날려 막아냅니다!`, (v) => `But ${v.k} dives to keep it out!`, (v) => `Tapi ${v.k} terbang menghalau bola!`),
  say((v) => `${v.k}의 슈퍼 세이브! 손끝으로 쳐냅니다!`, (v) => `A super save from ${v.k}! Fingertips to push it away!`, (v) => `Penyelamatan super dari ${v.k}! Ditepis dengan ujung jari!`),
  say((v) => `${j(v.k, '이/가')} 정면에서 단단하게 잡아냅니다. 안정감 최고!`, (v) => `${v.k} holds it firmly. Rock solid!`, (v) => `${v.k} menangkap bola dengan mantap. Sangat tenang!`),
  say((v) => `${v.k}, 엄청난 반사신경! 거미손이에요!`, (v) => `Incredible reflexes from ${v.k}! Spider hands!`, (v) => `Refleks luar biasa dari ${v.k}! Tangan laba-laba!`),
  say((v) => `골대 구석으로 가던 공을 ${j(v.k, '이/가')} 다이빙으로 걷어내요!`, (v) => `It was heading for the corner, but ${v.k} dives to clear it!`, (v) => `Bola menuju pojok, tapi ${v.k} melompat menghalaunya!`),
  say((v) => `${j(v.k, '이/가')} 발로 막아냅니다! 팀을 구한 선방!`, (v) => `${v.k} blocks it with a foot! A save that rescues the team!`, (v) => `${v.k} menghalau dengan kaki! Penyelamatan yang menolong tim!`),
  say((v) => `${v.k}의 펀칭! 공이 멀리 튕겨 나가요!`, (v) => `${v.k} punches it clear! Far away it goes!`, (v) => `${v.k} meninju bola! Bola terpental jauh!`),
  say((v) => `1대1 위기! 하지만 ${j(v.k, '이/가')} 각도를 좁혀 막아냅니다!`, (v) => `One on one! But ${v.k} closes the angle and saves!`, (v) => `Satu lawan satu! Tapi ${v.k} menutup sudut dan menyelamatkan!`),
  say((v) => `${j(v.k, '이/가')} 공을 쳐내 크로스바 위로 넘겨요! 코너킥!`, (v) => `${v.k} tips it over the bar! Corner kick!`, (v) => `${v.k} menepis bola ke atas mistar! Tendangan sudut!`),
  say((v) => `${v.k}, 방향을 완벽히 읽었어요! 깔끔하게 품에 안습니다.`, (v) => `${v.k} read it perfectly! Gathers it cleanly.`, (v) => `${v.k} membaca arah dengan sempurna! Menangkap bola dengan rapi.`),
  say((v) => `${j(v.k, '이/가')} 쳐낸 공을 ${j(v.d, '이/가')} 걷어냅니다! 위기 탈출!`, (v) => `${v.k} parries and ${v.d} hacks it clear! Danger over!`, (v) => `${v.k} menepis dan ${v.d} menyapu bola! Bahaya teratasi!`),
  say((v) => `${v.k}의 연속 선방! 두 번이나 막아냈어요!`, (v) => `A double save from ${v.k}! Two stops in a row!`, (v) => `Penyelamatan ganda dari ${v.k}! Dua kali berturut-turut!`),
  say((v) => `${j(v.k, '이/가')} 끝까지 버티다가 발끝으로 막아요! 침착해요!`, (v) => `${v.k} stays big and blocks it with a toe! So composed!`, (v) => `${v.k} bertahan sampai akhir dan menahan dengan ujung kaki! Sangat tenang!`),
  say((v) => `골문 앞에서 ${v.k}의 몸을 던진 수비! 정말 용감해요!`, (v) => `${v.k} throws the body in front of goal! So brave!`, (v) => `${v.k} menjatuhkan badan di depan gawang! Sangat berani!`),
];

export const MISS: Line<ShotVars>[] = [
  say((v) => `${v.s}의 슈팅이 아깝게 빗나갑니다!`, (v) => `${v.s}'s shot goes just wide!`, (v) => `Tembakan ${v.s} sedikit melebar!`),
  say((v) => `${v.s}, 골대를 살짝 넘기네요. 아쉬워요!`, (v) => `${v.s} sends it just over the bar. So close!`, (v) => `${v.s} menembak sedikit di atas mistar. Sayang sekali!`),
  say((v) => `땅! ${v.s}의 슈팅이 골대를 맞고 튕겨 나옵니다!`, (v) => `Clang! ${v.s}'s shot hits the post and bounces out!`, (v) => `Tang! Tembakan ${v.s} membentur tiang dan memantul keluar!`),
  say((v) => `${v.s}의 슈팅이 크로스바를 때려요! 정말 아까웠어요!`, (v) => `${v.s} smacks the crossbar! That was so close!`, (v) => `${v.s} menghantam mistar! Nyaris sekali!`),
  say((v) => `${j(v.d, '이/가')} 몸으로 ${v.s}의 슈팅을 막아냅니다! 투지 넘치는 수비!`, (v) => `${v.d} throws everything in front of ${v.s}'s shot! What determination!`, (v) => `${v.d} memblok tembakan ${v.s} dengan badan! Pertahanan penuh semangat!`),
  say((v) => `${v.s}, 너무 힘이 들어갔어요. 공이 관중석으로 날아가요!`, (v) => `${v.s} put too much on it. That one's gone into the crowd!`, (v) => `${v.s} terlalu bertenaga. Bola terbang ke tribun penonton!`),
  say((v) => `${v.s}의 슈팅이 골대 옆 그물을 스칩니다. 거의 들어갈 뻔!`, (v) => `${v.s}'s shot grazes the side netting. Almost!`, (v) => `Tembakan ${v.s} menyerempet jaring samping. Hampir saja!`),
  say((v) => `${j(v.s, '이/가')} 헛발질! 공이 발에 제대로 맞지 않았어요.`, (v) => `${v.s} miskicks it! Didn't catch it cleanly.`, (v) => `${v.s} salah menendang! Bola tidak kena dengan pas.`),
  say((v) => `${v.s}의 감아차기가 골대 밖으로 살짝 휘어 나가요.`, (v) => `${v.s}'s curler bends just outside the post.`, (v) => `Tendangan melengkung ${v.s} berbelok tipis di luar tiang.`),
  say((v) => `수비수 ${v.d}의 태클에 ${v.s}의 슈팅이 막힙니다!`, (v) => `A tackle from defender ${v.d} blocks ${v.s}'s shot!`, (v) => `Tekel bek ${v.d} memblok tembakan ${v.s}!`),
  say((v) => `${v.s}의 헤더! 하지만 골대 위로 넘어가요.`, (v) => `A header from ${v.s}! But it goes over the bar.`, (v) => `Sundulan ${v.s}! Tapi melambung di atas mistar.`),
  say((v) => `${j(v.s, '이/가')} 슈팅 타이밍을 놓쳤어요. ${j(v.d, '이/가')} 공을 걷어냅니다.`, (v) => `${v.s} took too long to shoot. ${v.d} clears it.`, (v) => `${v.s} terlambat menembak. ${v.d} menyapu bola.`),
  say((v) => `${v.s}의 발리 슛이 골대 옆으로 크게 벗어나요.`, (v) => `The volley from ${v.s} flies well wide.`, (v) => `Voli ${v.s} melebar jauh dari gawang.`),
  say((v) => `${v.s}, 골키퍼만 보고 찼는데… 골대 바깥쪽이에요!`, (v) => `${v.s} only had the keeper to beat... but it's outside the post!`, (v) => `${v.s} tinggal berhadapan dengan kiper... tapi bola di luar tiang!`),
  say((v) => `${j(v.d, '이/가')} 마지막 순간 발을 뻗어 ${v.s}의 슈팅을 굴절시켜요!`, (v) => `${v.d} sticks out a leg at the last second to deflect the shot from ${v.s}!`, (v) => `${v.d} menjulurkan kaki di detik terakhir dan membelokkan tembakan ${v.s}!`),
  say((v) => `${v.s}의 칩슛이 너무 높았어요. 골대를 넘어갑니다.`, (v) => `The chip from ${v.s} is too high. Over the bar.`, (v) => `Cungkilan ${v.s} terlalu tinggi. Melewati mistar.`),
  say((v) => `${j(v.s, '이/가')} 넘어지면서 찬 슈팅, 힘이 실리지 않았어요.`, (v) => `${v.s} shoots while falling, no power behind it.`, (v) => `${v.s} menembak sambil terjatuh, tanpa tenaga.`),
  say((v) => `${v.s}의 중거리 슛! 골대 위로 훌쩍 넘어가요.`, (v) => `A long-range effort from ${v.s}! Sails over the bar.`, (v) => `Tembakan jarak jauh ${v.s}! Melambung di atas mistar.`),
];

export const BUILD_UP: Line<ShotVars & { m: string }>[] = [
  say((v) => `${v.m}의 정확한 패스! ${j(v.s, '이/가')} 공을 받았지만 수비가 빨랐어요.`, (v) => `An accurate pass from ${v.m}! ${v.s} receives it, but the defense was quicker.`, (v) => `Umpan akurat dari ${v.m}! ${v.s} menerimanya, tapi pertahanan lebih cepat.`),
  say((v) => `${v.team}의 짧은 패스 연결이 이어집니다. ${v.m} → ${v.s}!`, (v) => `${v.team} keep the short passes flowing. ${v.m} to ${v.s}!`, (v) => `${v.team} terus mengalirkan umpan pendek. ${v.m} ke ${v.s}!`),
  say((v) => `${j(v.m, '이/가')} 중원에서 공을 빼앗아 바로 공격으로 전환해요!`, (v) => `${v.m} wins it in midfield and switches straight to attack!`, (v) => `${v.m} merebut bola di lini tengah dan langsung menyerang!`),
  say((v) => `${v.s}, 측면을 돌파해 크로스! 하지만 ${j(v.d, '이/가')} 걷어냅니다.`, (v) => `${v.s} beats a defender on the wing and crosses! But ${v.d} clears it.`, (v) => `${v.s} melewati bek di sayap dan mengirim umpan silang! Tapi ${v.d} menyapunya.`),
  say((v) => `${v.team}, 원투 패스로 수비를 흔들어요! 기회가 올 것 같아요!`, (v) => `${v.team} play a one-two to unsettle the defense! A chance is coming!`, (v) => `${v.team} bermain umpan satu-dua untuk mengacaukan pertahanan! Peluang akan datang!`),
  say((v) => `${j(v.m, '이/가')} 넓게 벌려주는 롱패스! ${v.team}의 공격이 시작돼요.`, (v) => `${v.m} spreads it wide with a long pass! ${v.team} are on the attack.`, (v) => `${v.m} melebarkan permainan dengan umpan panjang! ${v.team} mulai menyerang.`),
  say((v) => `${v.s}의 침투! 아쉽게 패스가 조금 길었어요.`, (v) => `${v.s} makes a run! But the pass was a little too long.`, (v) => `${v.s} menusuk ke depan! Sayang umpannya sedikit terlalu panjang.`),
  say((v) => `${v.team}의 빠른 템포 공격! 상대 수비가 바빠졌어요.`, (v) => `${v.team} attack at a high tempo! The defense is under pressure.`, (v) => `${v.team} menyerang dengan tempo tinggi! Pertahanan lawan kerepotan.`),
  say((v) => `${j(v.m, '이/가')} 힐패스로 ${v.s}에게! 하지만 ${j(v.d, '이/가')} 먼저 발을 뻗어요.`, (v) => `A backheel from ${v.m} to ${v.s}! But ${v.d} gets a foot in first.`, (v) => `Umpan tumit ${v.m} ke ${v.s}! Tapi ${v.d} lebih dulu menjulurkan kaki.`),
  say((v) => `${v.s}, 등지고 공을 지켜내요. ${v.m}에게 다시 돌려줍니다.`, (v) => `${v.s} holds it up with the back to goal and lays it off to ${v.m}.`, (v) => `${v.s} menahan bola membelakangi gawang dan mengembalikannya ke ${v.m}.`),
  say((v) => `${v.team}, 뒤에서부터 차근차근 공을 올려요.`, (v) => `${v.team} build patiently from the back.`, (v) => `${v.team} membangun serangan dengan sabar dari belakang.`),
  say((v) => `${j(v.m, '이/가')} 수비 두 명 사이로 스루패스! ${v.s}, 한 발 늦었어요!`, (v) => `${v.m} threads it between two defenders! ${v.s} is a step too late!`, (v) => `${v.m} mengirim umpan terobosan di antara dua bek! ${v.s} terlambat selangkah!`),
  say((v) => `${v.s}의 크로스가 길어요. 반대편으로 넘어갑니다.`, (v) => `The cross from ${v.s} is overhit. Out the other side.`, (v) => `Umpan silang ${v.s} terlalu panjang. Keluar di sisi lain.`),
  say((v) => `${j(v.d, '이/가')} ${v.s}의 돌파를 끈질기게 따라붙어 막아요!`, (v) => `${v.d} sticks to ${v.s} and stops the run!`, (v) => `${v.d} terus menempel ${v.s} dan menghentikan terobosannya!`),
  say((v) => `${v.team}, 측면에서 중앙으로 공을 돌리며 빈틈을 찾아요.`, (v) => `${v.team} work it from the wing to the middle, looking for a gap.`, (v) => `${v.team} mengalirkan bola dari sayap ke tengah, mencari celah.`),
  say((v) => `${v.m}의 대각선 패스! ${j(v.s, '이/가')} 받으려 했지만 수비가 끊어요.`, (v) => `A diagonal ball from ${v.m}! ${v.s} goes for it, but the defense cuts it out.`, (v) => `Umpan diagonal dari ${v.m}! ${v.s} mengejarnya, tapi pertahanan memotongnya.`),
];

// ─────────────── 자책골 / 페널티킥 실축 ───────────────

export const OWN_GOAL: Line<{ d: string; team: string; other: string; score: string }>[] = [
  say((v) => `아앗! ${v.d}의 발에 맞은 공이 그대로 자기 골문으로! 자책골이에요! ${v.team} 득점! (${v.score})`, (v) => `Oh no! It comes off ${v.d} and into the wrong net! An own goal! ${v.team} score! (${v.score})`, (v) => `Aduh! Bola mengenai ${v.d} dan masuk ke gawang sendiri! Gol bunuh diri! ${v.team} mencetak gol! (${v.score})`),
  say((v) => `걷어내려던 ${v.d}의 클리어링이 골대 안으로… ${v.other}에게는 너무 아픈 자책골! (${v.score})`, (v) => `${v.d} tries to clear it but finds the net instead... a painful own goal for ${v.other}! (${v.score})`, (v) => `${v.d} mencoba menyapu bola tapi malah masuk ke gawang... gol bunuh diri yang menyakitkan untuk ${v.other}! (${v.score})`),
  say((v) => `${v.d}, 골키퍼에게 돌려준 백패스가 너무 강했어요! 자책골! (${v.score})`, (v) => `${v.d} plays the back pass far too hard! Own goal! (${v.score})`, (v) => `Umpan balik ${v.d} ke kiper terlalu keras! Gol bunuh diri! (${v.score})`),
  say((v) => `${v.team}의 크로스가 ${v.d}의 머리에 맞고 굴절! 골키퍼도 어쩔 수 없었어요. 자책골! (${v.score})`, (v) => `A cross from ${v.team} deflects off the head of ${v.d}! The keeper had no chance. Own goal! (${v.score})`, (v) => `Umpan silang ${v.team} membentur kepala ${v.d}! Kiper tak berdaya. Gol bunuh diri! (${v.score})`),
  say((v) => `이런 일이! ${j(v.d, '이/가')} 막으려다 오히려 자기 골문에 넣고 말았어요. (${v.score})`, (v) => `Unbelievable! ${v.d} tried to block it and turned it into the own net. (${v.score})`, (v) => `Tak bisa dipercaya! ${v.d} mencoba menghalau tapi malah memasukkan ke gawang sendiri. (${v.score})`),
  say((v) => `${j(v.d, '은/는')} 고개를 숙이지만, 동료들이 다가가 어깨를 두드려 줘요. ${v.team} 행운의 골! (${v.score})`, (v) => `${v.d} hangs the head as teammates come over to console. A lucky goal for ${v.team}! (${v.score})`, (v) => `${v.d} tertunduk, rekan setim datang menghibur. Gol beruntung untuk ${v.team}! (${v.score})`),
];

export const PK_SAVE: Line<ShotVars>[] = [
  say((v) => `페널티킥! ${j(v.s, '이/가')} 찼는데… ${v.k}의 선방!!! 방향을 완벽하게 읽었어요!`, (v) => `Penalty! ${v.s} takes it... and ${v.k} saves!!! Read it perfectly!`, (v) => `Penalti! ${v.s} menendang... dan ${v.k} menyelamatkan!!! Membaca arah dengan sempurna!`),
  say((v) => `${v.s}의 페널티킥을 ${j(v.k, '이/가')} 막아냅니다! 오늘의 영웅이 될 수도 있어요!`, (v) => `${v.k} stops the penalty from ${v.s}! Could be the hero today!`, (v) => `${v.k} menggagalkan penalti ${v.s}! Bisa jadi pahlawan hari ini!`),
  say((v) => `${j(v.k, '이/가')} 끝까지 기다렸다가 발로 막아요! ${v.s}의 페널티킥 실패!`, (v) => `${v.k} waits until the last moment and saves with a foot! ${v.s} misses the penalty!`, (v) => `${v.k} menunggu sampai detik terakhir dan menahan dengan kaki! Penalti ${v.s} gagal!`),
  say((v) => `숨 막히는 순간… ${v.k}, 몸을 날려 페널티킥을 쳐냅니다! 거미손!`, (v) => `A breathless moment... ${v.k} dives and pushes the penalty away! Spider hands!`, (v) => `Momen menegangkan... ${v.k} melompat dan menepis penalti! Tangan laba-laba!`),
  say((v) => `${v.s}, 페널티킥을 너무 정직하게 찼어요. ${j(v.k, '이/가')} 가볍게 잡아냅니다!`, (v) => `${v.s} hits the penalty straight at ${v.k}, who catches it easily!`, (v) => `Penalti ${v.s} terlalu lurus. ${v.k} menangkapnya dengan mudah!`),
];

export const PK_MISS: Line<ShotVars>[] = [
  say((v) => `페널티킥! ${v.s}의 슈팅이… 크로스바 위로! 믿을 수 없는 실축이에요!`, (v) => `Penalty! ${v.s} shoots... over the bar! An unbelievable miss!`, (v) => `Penalti! Tembakan ${v.s}... melambung di atas mistar! Kegagalan yang sulit dipercaya!`),
  say((v) => `${v.s}의 페널티킥이 골대를 맞고 튕겨 나와요! 땅! 아까워요!`, (v) => `The penalty from ${v.s} hits the post and bounces out! Clang! So close!`, (v) => `Penalti ${v.s} membentur tiang dan memantul keluar! Tang! Sayang sekali!`),
  say((v) => `${j(v.s, '이/가')} 파넨카킥을 시도했지만 너무 약했어요! 실축!`, (v) => `${v.s} tries a Panenka, but it's far too soft! Missed!`, (v) => `${v.s} mencoba Panenka, tapi terlalu pelan! Gagal!`),
  say((v) => `${v.s}, 페널티킥이 골대 옆으로 벗어납니다! 머리를 감싸 쥐어요.`, (v) => `${v.s} drags the penalty wide! Hands on head.`, (v) => `Penalti ${v.s} melebar dari gawang! Memegangi kepala.`),
  say((v) => `${j(v.s, '이/가')} 디딤발이 미끄러졌어요! 페널티킥이 하늘 높이 날아갑니다!`, (v) => `${v.s} slips on the standing foot! The penalty flies high into the sky!`, (v) => `Kaki tumpuan ${v.s} terpeleset! Penalti melambung tinggi ke langit!`),
];

// ─────────────── 감독 전술이 드러나는 공격 전개 ───────────────
// 전술이 있는 팀의 BUILD_UP 문장을 대신한다 (팀·하프당 최대 2번, 난수 없이 고른다)

export const TACTIC_LINES: Record<Exclude<TacticKey, 'balanced'>, Line<{ team: string; s: string }>[]> = {
  attacking: [
    say((v) => `${v.team}, 수비수까지 올라와서 총공격!`, (v) => `${v.team} push everyone forward, even the defenders! All-out attack!`, (v) => `${v.team} mendorong semua pemain ke depan, bahkan para bek! Serangan total!`),
    say((v) => `${j(v.team, '이/가')} 작전대로 앞으로, 앞으로! 쉬지 않고 몰아붙여요!`, (v) => `${v.team} go forward, forward, just as planned! Relentless pressure!`, (v) => `${v.team} maju terus sesuai rencana! Menekan tanpa henti!`),
  ],
  defensive: [
    say((v) => `${v.team}, 모두 내려와서 골문을 단단히 지킵니다!`, (v) => `${v.team} drop deep and guard their goal tightly!`, (v) => `${v.team} mundur dan menjaga gawang dengan rapat!`),
    say((v) => `${v.team}의 수비벽이 촘촘해요. 작전대로 버티는 중!`, (v) => `${v.team}'s defensive wall is tight. Holding firm, as planned!`, (v) => `Tembok pertahanan ${v.team} sangat rapat. Bertahan sesuai rencana!`),
  ],
  counter: [
    say((v) => `${v.team}, 공을 잡자마자 번개 같은 역습!`, (v) => `${v.team} win the ball and break like lightning!`, (v) => `${v.team} merebut bola dan melancarkan serangan balik secepat kilat!`),
    say((v) => `${j(v.s, '이/가')} 뒷공간으로 질주! ${v.team}의 작전이 보여요!`, (v) => `${v.s} sprints into the space behind! You can see ${v.team}'s plan!`, (v) => `${v.s} berlari ke ruang kosong di belakang! Rencana ${v.team} terlihat jelas!`),
  ],
  possession: [
    say((v) => `${v.team}, 짧은 패스로 공을 돌리며 기회를 엿봅니다.`, (v) => `${v.team} keep it moving with short passes, waiting for a chance.`, (v) => `${v.team} memutar bola dengan umpan pendek sambil menunggu peluang.`),
    say((v) => `${v.team}의 패스가 끊기지 않아요. 공을 오래 지키는 작전!`, (v) => `${v.team}'s passing never stops. They're keeping the ball, as planned!`, (v) => `Umpan ${v.team} tak pernah putus. Menguasai bola sesuai rencana!`),
  ],
  press: [
    say((v) => `${v.team}, 앞에서부터 우르르 달려들어 압박!`, (v) => `${v.team} swarm forward and press high!`, (v) => `${v.team} menyerbu ke depan dan menekan tinggi!`),
    say((v) => `${v.team}의 강한 압박! 상대가 공을 잡을 틈이 없어요!`, (v) => `Intense pressing from ${v.team}! The opponents get no time on the ball!`, (v) => `Tekanan keras dari ${v.team}! Lawan tak punya waktu menguasai bola!`),
  ],
  wing: [
    say((v) => `${v.s}, 측면을 따라 달려 크로스를 올립니다!`, (v) => `${v.s} races down the wing and whips in a cross!`, (v) => `${v.s} berlari di sayap dan mengirim umpan silang!`),
    say((v) => `${j(v.team, '이/가')} 작전대로 측면을 파고듭니다!`, (v) => `${v.team} attack down the flanks, just as planned!`, (v) => `${v.team} menyerang lewat sayap sesuai rencana!`),
  ],
  center: [
    say((v) => `${v.s}, 가운데로 드리블 돌파를 시도합니다!`, (v) => `${v.s} tries to dribble straight through the middle!`, (v) => `${v.s} mencoba menggiring bola menembus lini tengah!`),
    say((v) => `${v.team}, 중앙을 정면으로 뚫으려 해요!`, (v) => `${v.team} try to break straight through the center!`, (v) => `${v.team} berusaha menembus langsung lewat tengah!`),
  ],
  longball: [
    say((v) => `${v.team}, 길게 한 번에! 롱볼이 날아갑니다!`, (v) => `${v.team} go long! The long ball is flying!`, (v) => `${v.team} bermain bola panjang! Bola melambung jauh!`),
    say((v) => `${j(v.s, '을/를')} 향한 긴 패스! ${v.team}의 롱볼 작전!`, (v) => `A long pass toward ${v.s}! ${v.team}'s long-ball plan!`, (v) => `Umpan panjang ke arah ${v.s}! Rencana bola panjang ${v.team}!`),
  ],
};

// ─────────────── 세트피스 / 반칙 / 카드 / 부상 ───────────────

interface TeamVars {
  team: string;
  p: string;
}

export const CORNER: Line<TeamVars>[] = [
  say((v) => `${v.team}의 코너킥 기회!`, (v) => `A corner kick for ${v.team}!`, (v) => `Tendangan sudut untuk ${v.team}!`),
  say((v) => `${j(v.p, '이/가')} 코너킥을 차러 갑니다. 골문 앞이 북적북적해요!`, (v) => `${v.p} goes to take the corner. It's crowded in front of goal!`, (v) => `${v.p} bersiap mengambil tendangan sudut. Depan gawang penuh sesak!`),
  say((v) => `수비수 발에 맞고 나간 공, ${v.team}의 코너킥이에요.`, (v) => `Off a defender's foot and out, corner to ${v.team}.`, (v) => `Bola mengenai kaki bek dan keluar, tendangan sudut untuk ${v.team}.`),
  say((v) => `${v.team}, 연속 코너킥! 계속 몰아붙여요!`, (v) => `Another corner for ${v.team}! They keep pushing!`, (v) => `Tendangan sudut lagi untuk ${v.team}! Mereka terus menekan!`),
  say((v) => `${v.p}의 코너킥이 날카롭게 휘어 들어가요!`, (v) => `${v.p}'s corner swings in dangerously!`, (v) => `Tendangan sudut ${v.p} melengkung berbahaya!`),
  say((v) => `${v.team}, 짧은 코너킥으로 약속된 플레이를 시도해요!`, (v) => `${v.team} try a short corner routine from the training ground!`, (v) => `${v.team} mencoba skema sepak pojok pendek!`),
  say((v) => `${j(v.p, '이/가')} 니어포스트로 낮게 붙여요! 수비가 겨우 걷어냅니다.`, (v) => `${v.p} whips it low to the near post! The defense just about clears it.`, (v) => `${v.p} mengirim bola mendatar ke tiang dekat! Pertahanan susah payah menyapunya.`),
  say((v) => `${v.team}의 코너킥, 키 큰 선수들이 모두 골문 앞으로 올라왔어요!`, (v) => `Corner for ${v.team}, and all the tall players have come forward!`, (v) => `Tendangan sudut untuk ${v.team}, semua pemain jangkung maju ke depan gawang!`),
];

export const OFFSIDE: Line<TeamVars>[] = [
  say((v) => `${v.p}, 너무 빨리 뛰어나갔어요. 오프사이드!`, (v) => `${v.p} went too early. Offside!`, (v) => `${v.p} bergerak terlalu cepat. Offside!`),
  say((v) => `부심의 깃발이 올라갑니다! ${v.p}의 오프사이드예요.`, (v) => `Up goes the linesman's flag! ${v.p} is offside.`, (v) => `Bendera hakim garis terangkat! ${v.p} offside.`),
  say((v) => `${v.team}의 공격, 아쉽게 오프사이드에 걸려요.`, (v) => `${v.team}'s attack is caught offside. Unlucky.`, (v) => `Serangan ${v.team} terjebak offside. Sayang sekali.`),
  say((v) => `${j(v.p, '이/가')} 골을 넣었지만… 오프사이드! 노골이에요.`, (v) => `${v.p} puts it in, but... offside! No goal.`, (v) => `${v.p} memasukkan bola, tapi... offside! Gol dianulir.`),
  say((v) => `${v.p}, 반 발짝 앞서 있었어요. 아쉬운 오프사이드!`, (v) => `${v.p} was half a step ahead. Unlucky, offside!`, (v) => `${v.p} setengah langkah di depan. Sayang, offside!`),
  say((v) => `상대 수비의 오프사이드 트랩에 ${j(v.p, '이/가')} 걸렸어요!`, (v) => `${v.p} is caught by the offside trap!`, (v) => `${v.p} terjebak perangkap offside!`),
  say((v) => `VAR 확인 결과… ${v.p}의 오프사이드! 골이 취소됩니다.`, (v) => `After a VAR check... ${v.p} was offside! The goal is ruled out.`, (v) => `Setelah pengecekan VAR... ${v.p} offside! Gol dianulir.`),
];

export const FOUL: Line<TeamVars>[] = [
  say((v) => `${v.p}의 파울로 경기가 잠시 멈춥니다.`, (v) => `A foul by ${v.p} stops play for a moment.`, (v) => `Pelanggaran oleh ${v.p} menghentikan permainan sejenak.`),
  say((v) => `${j(v.p, '이/가')} 상대 유니폼을 잡아당겼어요. 파울!`, (v) => `${v.p} pulled on an opponent's shirt. Foul!`, (v) => `${v.p} menarik baju lawan. Pelanggaran!`),
  say((v) => `${v.p}의 늦은 태클! 주심이 휘슬을 불어요.`, (v) => `A late tackle from ${v.p}! The referee blows the whistle.`, (v) => `Tekel terlambat dari ${v.p}! Wasit meniup peluit.`),
  say((v) => `${j(v.p, '이/가')} 공 대신 발을 건드렸네요. 프리킥이 선언됩니다.`, (v) => `${v.p} caught the foot instead of the ball. Free kick given.`, (v) => `${v.p} mengenai kaki, bukan bola. Tendangan bebas diberikan.`),
  say((v) => `${v.p}의 반칙! 상대 팀에게 좋은 위치의 프리킥이에요.`, (v) => `A foul by ${v.p}! That's a free kick in a good spot for the opponents.`, (v) => `Pelanggaran oleh ${v.p}! Tendangan bebas di posisi bagus untuk lawan.`),
  say((v) => `몸싸움 과정에서 ${v.p}의 파울이 나왔어요.`, (v) => `${v.p} commits a foul in the physical battle.`, (v) => `${v.p} melakukan pelanggaran saat beradu badan.`),
  say((v) => `${j(v.p, '이/가')} 역습을 끊기 위해 일부러 반칙을 했어요. 영리한 파울!`, (v) => `${v.p} takes one for the team to stop the counter. A clever foul!`, (v) => `${v.p} sengaja melanggar untuk menghentikan serangan balik. Pelanggaran cerdik!`),
  say((v) => `${v.p}의 핸드볼 파울! 공이 팔에 맞았어요.`, (v) => `Handball by ${v.p}! It hit the arm.`, (v) => `Handball oleh ${v.p}! Bola mengenai lengan.`),
  say((v) => `${j(v.p, '이/가')} 뒤에서 밀었어요. 주심이 바로 휘슬!`, (v) => `${v.p} pushed from behind. The referee whistles straight away!`, (v) => `${v.p} mendorong dari belakang. Wasit langsung meniup peluit!`),
  say((v) => `공중볼 다툼에서 ${v.p}의 팔꿈치가 높았어요. 파울이에요.`, (v) => `A high elbow from ${v.p} in the aerial duel. Foul.`, (v) => `Siku ${v.p} terlalu tinggi saat duel udara. Pelanggaran.`),
];

export const YELLOW: Line<TeamVars>[] = [
  say((v) => `${v.p}에게 옐로카드! 조심해야 해요.`, (v) => `Yellow card for ${v.p}! Better be careful now.`, (v) => `Kartu kuning untuk ${v.p}! Harus hati-hati sekarang.`),
  say((v) => `주심이 노란 카드를 꺼냅니다. ${v.p}, 경고!`, (v) => `The referee reaches for the yellow. ${v.p} is booked!`, (v) => `Wasit mengeluarkan kartu kuning. ${v.p} mendapat peringatan!`),
  say((v) => `${v.p}의 거친 태클에 경고가 주어져요. 한 장 더 받으면 퇴장이에요!`, (v) => `A rough tackle earns ${v.p} a yellow. One more and it's a red!`, (v) => `Tekel keras membuat ${v.p} dapat kartu kuning. Satu lagi berarti kartu merah!`),
  say((v) => `${j(v.p, '이/가')} 항의하다 옐로카드를 받았어요. 침착해요!`, (v) => `${v.p} gets a yellow for arguing. Stay calm!`, (v) => `${v.p} dapat kartu kuning karena protes. Tetap tenang!`),
  say((v) => `역습을 끊은 ${v.p}, 결국 경고를 받습니다.`, (v) => `${v.p} stopped the counter and gets booked for it.`, (v) => `${v.p} menghentikan serangan balik dan akhirnya mendapat kartu kuning.`),
  say((v) => `${j(v.p, '이/가')} 시간을 끌다가 옐로카드! 주심이 단호해요.`, (v) => `${v.p} is booked for time-wasting! The referee is firm.`, (v) => `${v.p} dapat kartu kuning karena mengulur waktu! Wasit tegas.`),
  say((v) => `${v.p}의 과격한 몸싸움, 노란 카드가 나와요!`, (v) => `Overly physical from ${v.p}, out comes the yellow!`, (v) => `Duel terlalu keras dari ${v.p}, kartu kuning keluar!`),
];

export const RED: Line<TeamVars>[] = [
  say((v) => `퇴장! ${j(v.p, '이/가')} 레드카드를 받았어요! ${j(v.team, '은/는')} 이제 한 명이 부족해요.`, (v) => `Sent off! ${v.p} gets a red card! ${v.team} are down to ten.`, (v) => `Diusir keluar! ${v.p} mendapat kartu merah! ${v.team} kini kekurangan satu pemain.`),
  say((v) => `주심이 빨간 카드를 높이 듭니다! ${v.p} 퇴장!`, (v) => `The referee holds the red card high! ${v.p} is off!`, (v) => `Wasit mengangkat kartu merah tinggi-tinggi! ${v.p} keluar!`),
  say((v) => `${v.p}의 위험한 태클! 바로 레드카드예요. ${v.team}에게 큰 위기!`, (v) => `A dangerous tackle by ${v.p}! Straight red. Big trouble for ${v.team}!`, (v) => `Tekel berbahaya oleh ${v.p}! Langsung kartu merah. Masalah besar untuk ${v.team}!`),
  say((v) => `VAR 확인 후 판정이 바뀝니다! ${v.p}, 레드카드 퇴장!`, (v) => `After a VAR review the decision changes! ${v.p} is shown red!`, (v) => `Setelah tinjauan VAR keputusan berubah! ${v.p} mendapat kartu merah!`),
  say((v) => `결정적인 득점 기회를 반칙으로 막은 ${v.p}! 퇴장입니다!`, (v) => `${v.p} denies a clear goal-scoring chance with a foul! Sent off!`, (v) => `${v.p} menggagalkan peluang emas dengan pelanggaran! Diusir keluar!`),
];

export const INJURY: Line<TeamVars>[] = [
  say((v) => `${j(v.p, '이/가')} 다리를 붙잡고 쓰러졌어요. 교체가 필요할 수도 있어요!`, (v) => `${v.p} is down holding a leg. A substitution might be needed!`, (v) => `${v.p} terjatuh sambil memegangi kaki. Mungkin perlu pergantian pemain!`),
  say((v) => `${v.p}, 충돌 후 일어나지 못하고 있어요. 의료진이 들어갑니다. 🚑`, (v) => `${v.p} can't get up after the collision. The medics are coming on. 🚑`, (v) => `${v.p} belum bisa bangun setelah benturan. Tim medis masuk ke lapangan. 🚑`),
  say((v) => `${j(v.p, '이/가')} 발목을 불편해해요. 감독님, 교체를 고민해야 할 때예요!`, (v) => `${v.p} is struggling with an ankle. Coach, time to think about a sub!`, (v) => `${v.p} kesakitan di pergelangan kaki. Pelatih, saatnya memikirkan pergantian!`),
  say((v) => `${v.p}의 근육에 문제가 생긴 것 같아요. 무리하면 안 돼요!`, (v) => `Looks like ${v.p} has a muscle problem. Better not push it!`, (v) => `Sepertinya otot ${v.p} bermasalah. Jangan dipaksakan!`),
  say((v) => `${j(v.p, '이/가')} 공중볼 경합 후 머리를 감싸 쥐어요. 걱정되네요.`, (v) => `${v.p} is holding the head after an aerial challenge. Worrying.`, (v) => `${v.p} memegangi kepala setelah duel udara. Mengkhawatirkan.`),
  say((v) => `${v.p}, 절뚝거리며 경기를 이어가요. 괜찮을까요?`, (v) => `${v.p} is limping but carries on. Will they be okay?`, (v) => `${v.p} terpincang-pincang tapi tetap bermain. Apakah baik-baik saja?`),
];

// ─────────────── 분위기 ───────────────

export const AMBIENCE: Line<{ team: string; other: string; p: string }>[] = [
  say(() => `관중석에서 파도타기 응원이 시작됐어요! 🌊`, () => `The crowd starts a Mexican wave! 🌊`, () => `Penonton mulai membuat gelombang Meksiko! 🌊`),
  say((v) => `${j(v.team, '이/가')} 공을 오래 소유하며 경기를 주도해요.`, (v) => `${v.team} keep the ball and control the game.`, (v) => `${v.team} menguasai bola dan mengendalikan permainan.`),
  say((v) => `${v.team} 응원단의 북소리가 경기장을 울려요! 🥁`, (v) => `The ${v.team} fans' drums echo around the stadium! 🥁`, (v) => `Tabuhan drum pendukung ${v.team} menggema di stadion! 🥁`),
  say((v) => `${j(v.other, '은/는')} 수비 라인을 내리고 역습을 노리는 작전이에요.`, (v) => `${v.other} sit deep and look to hit on the counter.`, (v) => `${v.other} bertahan dalam dan mengincar serangan balik.`),
  say(() => `양 팀 모두 숨을 고르는 중이에요. 다음 공격은 누가 먼저 할까요?`, () => `Both teams are catching their breath. Who will attack next?`, () => `Kedua tim sedang mengatur napas. Siapa yang akan menyerang lebih dulu?`),
  say((v) => `${v.team} 벤치에서 감독님이 큰 소리로 작전을 지시해요! 📣`, (v) => `The ${v.team} coach is shouting instructions from the bench! 📣`, (v) => `Pelatih ${v.team} berteriak memberi instruksi dari bangku cadangan! 📣`),
  say((v) => `${j(v.p, '이/가')} 오늘 정말 많이 뛰어다니고 있어요. 체력왕!`, (v) => `${v.p} is running everywhere today. What stamina!`, (v) => `${v.p} berlari ke mana-mana hari ini. Staminanya luar biasa!`),
  say((v) => `${j(v.team, '이/가')} 측면을 넓게 쓰면서 상대를 흔들어요.`, (v) => `${v.team} use the full width to stretch the opponents.`, (v) => `${v.team} memanfaatkan lebar lapangan untuk meregangkan lawan.`),
  say(() => `중원에서 치열한 공 다툼이 이어져요! 누구도 물러서지 않아요.`, () => `A fierce battle for the ball in midfield! Nobody is backing down.`, () => `Perebutan bola sengit di lini tengah! Tak ada yang mau mengalah.`),
  say((v) => `${v.other}, 촘촘한 수비로 ${j(v.team, '을/를')} 꽁꽁 묶고 있어요.`, (v) => `${v.other} are keeping ${v.team} locked up with tight defending.`, (v) => `${v.other} mengunci ${v.team} dengan pertahanan yang rapat.`),
  say(() => `경기장에 함성이 가득해요! 분위기가 점점 뜨거워집니다! 🔥`, () => `The stadium is roaring! The atmosphere is heating up! 🔥`, () => `Stadion bergemuruh! Suasana makin panas! 🔥`),
  say((v) => `${j(v.p, '이/가')} 동료들에게 손짓하며 집중하자고 외쳐요!`, (v) => `${v.p} waves to the teammates, telling everyone to stay focused!`, (v) => `${v.p} memberi isyarat ke rekan setim agar tetap fokus!`),
  say(() => `비가 조금씩 내리기 시작했어요. 잔디가 미끄러워질 것 같아요! 🌧️`, () => `It's starting to rain. The pitch could get slippery! 🌧️`, () => `Hujan mulai turun. Lapangan bisa jadi licin! 🌧️`),
  say((v) => `${v.team} 팬들이 선수들 이름을 하나씩 외치고 있어요! 📢`, (v) => `The ${v.team} fans are chanting the players' names one by one! 📢`, (v) => `Pendukung ${v.team} meneriakkan nama para pemain satu per satu! 📢`),
  say((v) => `${j(v.other, '은/는')} 공을 뺏자마자 빠르게 앞으로 보내려 해요.`, (v) => `${v.other} try to go forward quickly as soon as they win the ball.`, (v) => `${v.other} berusaha cepat maju begitu merebut bola.`),
  say(() => `공이 터치라인 밖으로 나갔어요. 잠시 숨 돌릴 시간!`, () => `The ball goes out for a throw-in. A moment to breathe!`, () => `Bola keluar lapangan. Saatnya mengambil napas sejenak!`),
  say((v) => `${j(v.p, '이/가')} 물을 마시며 감독님 지시를 듣고 있어요.`, (v) => `${v.p} grabs a drink and listens to the coach's instructions.`, (v) => `${v.p} minum sambil mendengarkan instruksi pelatih.`),
  say((v) => `${v.team}의 패스 성공률이 아주 높아요. 공을 잘 지키고 있어요!`, (v) => `${v.team} are completing almost every pass. Great ball retention!`, (v) => `Akurasi umpan ${v.team} sangat tinggi. Penguasaan bola yang bagus!`),
  say(() => `관중석에서 응원가가 울려 퍼집니다! 🎶`, () => `Songs ring out from the stands! 🎶`, () => `Nyanyian dukungan menggema dari tribun! 🎶`),
  say((v) => `${v.other} 감독님이 팔짱을 끼고 경기를 지켜보고 있어요. 🤔`, (v) => `The ${v.other} coach watches with arms folded. 🤔`, (v) => `Pelatih ${v.other} menyaksikan sambil bersedekap. 🤔`),
];

// ─────────────── 하프 정리 ───────────────

export interface SummaryVars {
  half: '전반전' | '후반전';
  home: string;
  away: string;
  hs: number;
  as: number;
  leader?: string;
  trailer?: string;
  mvp?: string;
  mvpGoals: number;
  shots: number;
  saves: number;
  topKeeper?: string;
}

/** 하프 이름 (영어·인도네시아어, 문장 첫머리용 / 문장 중간용) */
const halfNames = (v: SummaryVars) =>
  v.half === '전반전'
    ? { en: 'First half', en_: 'first half', id: 'Babak pertama', id_: 'babak pertama' }
    : { en: 'Second half', en_: 'second half', id: 'Babak kedua', id_: 'babak kedua' };

export function summaryTitle(c: Commentator, v: SummaryVars): Localized {
  const diff = Math.abs(v.hs - v.as);
  const isFinal = v.half === '후반전';
  const leader = v.leader;
  const H = halfNames(v);
  if (!leader) {
    if (v.hs === 0)
      return c.pick('t-00', [
        () => ({ ko: `${v.half}, 골 없는 팽팽한 싸움`, en: `${H.en}: a tight battle with no goals`, id: `${H.id}: duel ketat tanpa gol` }),
        () => ({ ko: `${v.half}, 수비가 빛난 0:0`, en: `${H.en}: 0-0, the defenders shine`, id: `${H.id}: 0-0, para bek bersinar` }),
      ], v);
    if (isFinal)
      return c.pick('t-fdraw', [
        () => ({ ko: `무승부! 치고받은 명승부`, en: `A draw! What a back-and-forth classic`, id: `Imbang! Laga seru saling balas` }),
        () => ({ ko: `${v.hs}:${v.as}, 누구도 지지 않았어요`, en: `${v.hs}-${v.as}, nobody lost today`, id: `${v.hs}-${v.as}, tak ada yang kalah hari ini` }),
      ], v);
    return c.pick('t-draw', [
      () => ({ ko: `${v.half}, 치고받는 명승부!`, en: `${H.en}: end-to-end action!`, id: `${H.id}: laga saling serang!` }),
      () => ({ ko: `${v.half}, 승부는 원점!`, en: `${H.en}: all square!`, id: `${H.id}: skor imbang!` }),
    ], v);
  }
  if (diff >= 3)
    return c.pick('t-big', [
      () => ({
        ko: `${leader}, ${isFinal ? '압도적인 대승!' : '전반부터 크게 앞서요!'}`,
        en: `${leader}, ${isFinal ? 'a dominant win!' : 'way ahead already!'}`,
        id: `${leader}, ${isFinal ? 'menang telak!' : 'sudah unggul jauh!'}`,
      }),
      () => ({ ko: `${leader}의 골 폭풍!`, en: `A goal storm from ${leader}!`, id: `Badai gol dari ${leader}!` }),
    ], v);
  if (isFinal)
    return c.pick('t-win', diff === 1
      ? [
          () => ({ ko: `${leader}, 한 골 차 짜릿한 승리!`, en: `${leader} win a thriller by one goal!`, id: `${leader} menang tipis satu gol yang menegangkan!` }),
          () => ({ ko: `손에 땀을 쥔 승부, ${leader} 승리!`, en: `A nail-biter, and ${leader} win it!`, id: `Laga yang mendebarkan, ${leader} menang!` }),
        ]
      : [
          () => ({ ko: `${leader}, 기분 좋은 승리!`, en: `A great win for ${leader}!`, id: `Kemenangan manis untuk ${leader}!` }),
          () => ({ ko: `${j(leader, '이/가')} 경기를 가져갑니다!`, en: `${leader} take the match!`, id: `${leader} memenangi pertandingan!` }),
          () => ({ ko: `오늘의 승자는 ${leader}!`, en: `Today's winners: ${leader}!`, id: `Pemenang hari ini: ${leader}!` }),
        ], v);
  if (diff === 1)
    return c.pick('t-close', [
      () => ({ ko: `${leader}, 한 골 차로 앞서며 마무리!`, en: `${leader} finish the half one goal up!`, id: `${leader} menutup babak dengan unggul satu gol!` }),
      () => ({ ko: `${v.half}, ${j(leader, '이/가')} 근소하게 앞서요`, en: `${H.en}: ${leader} just ahead`, id: `${H.id}: ${leader} unggul tipis` }),
    ], v);
  return c.pick('t-lead', [
    () => ({ ko: `${leader}, ${v.half}을 앞서며 마무리!`, en: `${leader} lead at the end of the ${H.en_}!`, id: `${leader} memimpin di akhir ${H.id_}!` }),
    () => ({ ko: `${j(leader, '이/가')} 주도한 ${v.half}`, en: `${H.en} controlled by ${leader}`, id: `${H.id} dikuasai ${leader}` }),
  ], v);
}

export function summaryText(c: Commentator, v: SummaryVars): Localized {
  const lines: Localized[] = [];
  const score = `${v.home} ${v.hs} : ${v.as} ${v.away}`;
  const scoreLatin = `${v.home} ${v.hs}-${v.as} ${v.away}`;
  const H = halfNames(v);
  const isFirst = v.half === '전반전';
  lines.push(
    c.pick('s-open', [
      () => ({ ko: `${v.half}이 끝났어요. ${score}.`, en: `The ${H.en_} is over. ${scoreLatin}.`, id: `${H.id} berakhir. ${scoreLatin}.` }),
      () => ({
        ko: `${v.half} 종료 휘슬! ${v.half === '후반전' ? '최종' : '현재'} 점수는 ${score}.`,
        en: `${H.en} whistle! The ${isFirst ? 'score now' : 'final score'} is ${scoreLatin}.`,
        id: `Peluit akhir ${H.id_}! Skor ${isFirst ? 'sementara' : 'akhir'} ${scoreLatin}.`,
      }),
      () => ({ ko: `숨 가빴던 ${v.half}이 마무리됐어요. ${score}!`, en: `A breathless ${H.en_} comes to an end. ${scoreLatin}!`, id: `${H.id} yang menegangkan telah usai. ${scoreLatin}!` }),
    ], v),
  );

  if (v.leader && v.trailer) {
    lines.push(
      isFirst
        ? c.pick('s-lead1', [
            () => ({
              ko: `${j(v.leader!, '이/가')} 리드하고 있어요! ${j(v.trailer!, '은/는')} 후반에 반격할 수 있을까요?`,
              en: `${v.leader} are in front! Can ${v.trailer} fight back in the second half?`,
              id: `${v.leader} sedang unggul! Bisakah ${v.trailer} membalas di babak kedua?`,
            }),
            () => ({
              ko: `${j(v.trailer!, '은/는')} 하프타임에 작전을 바꿔 볼 필요가 있어요!`,
              en: `${v.trailer} may need to change their plan at half-time!`,
              id: `${v.trailer} mungkin perlu mengubah strategi saat turun minum!`,
            }),
          ], v)
        : c.pick('s-lead2', [
            () => ({ ko: `${v.leader}의 승리! 모두 정말 잘 싸웠어요.`, en: `Victory for ${v.leader}! Everyone played really well.`, id: `Kemenangan untuk ${v.leader}! Semua pemain bermain sangat baik.` }),
            () => ({
              ko: `${j(v.leader!, '이/가')} 끝까지 리드를 지켜냈어요! ${v.trailer}도 박수 받을 만해요.`,
              en: `${v.leader} held on to the end! ${v.trailer} deserve a big round of applause too.`,
              id: `${v.leader} mempertahankan keunggulan sampai akhir! ${v.trailer} juga layak mendapat tepuk tangan.`,
            }),
          ], v),
    );
  } else {
    lines.push(
      c.pick('s-even', [
        () => ({ ko: `두 팀 모두 한 치의 양보도 없었어요.`, en: `Neither team gave an inch.`, id: `Kedua tim sama sekali tidak mau mengalah.` }),
        () =>
          isFirst
            ? { ko: `후반전에 승부가 갈릴 것 같아요!`, en: `The second half will decide it!`, id: `Babak kedua akan menentukan pemenangnya!` }
            : { ko: `무승부! 다음 경기에서 다시 붙어 봐요!`, en: `A draw! Let's settle it in the next match!`, id: `Imbang! Mari tentukan di pertandingan berikutnya!` },
      ], v),
    );
  }

  if (v.mvp && v.mvpGoals >= 2)
    lines.push({
      ko: `${j(v.mvp, '이/가')} ${v.mvpGoals}골을 넣으며 최고의 활약을 펼쳤어요!`,
      en: `${v.mvp} was the star with ${v.mvpGoals} goals!`,
      id: `${v.mvp} menjadi bintang dengan ${v.mvpGoals} gol!`,
    });
  else if (v.mvp) lines.push({ ko: `${v.mvp}의 골이 특히 빛났어요.`, en: `${v.mvp}'s goal really stood out.`, id: `Gol ${v.mvp} benar-benar menonjol.` });
  if (v.topKeeper && v.saves >= 3)
    lines.push({
      ko: `골키퍼 ${v.topKeeper}의 선방도 대단했어요! 🧤`,
      en: `Goalkeeper ${v.topKeeper} made some amazing saves too! 🧤`,
      id: `Kiper ${v.topKeeper} juga melakukan penyelamatan hebat! 🧤`,
    });
  if (v.shots >= 12)
    lines.push({ ko: `슈팅이 ${v.shots}개나 나온 화끈한 공격 축구였어요!`, en: `${v.shots} shots! What an attacking game!`, id: `${v.shots} tembakan! Laga yang sangat menyerang!` });
  return joinLocalized(lines);
}
