// Seeds the blog with the clinic's launch articles. Idempotent — existing slugs
// are skipped, so it is safe to run again (locally against the JSON store, or
// on Railway against Postgres):  node scripts/seed-blog.mjs
import { ensureSchema } from '../src/lib/pg.js';
import { createPost, listPosts } from '../src/lib/posts.js';

const AUTHOR = { authorName: 'Dr. Aisha Verma', authorRole: 'MBBS · Aesthetic Physician' };

const POSTS = [
  // ── migrated from the original markdown journal (same slugs, same URLs) ──
  {
    slug: 'how-to-choose-a-laser',
    title: 'How to choose between laser treatments',
    seoTitle: 'Pico vs Diode vs Fractional: Choosing a Laser | The Better Face',
    metaDescription: 'A plain-language guide to which laser does what, who each one suits, and the questions to ask any clinic before you book. Written by our clinical team.',
    excerpt: 'Most people are told a laser will fix their skin — without being told which laser, or why. The short, honest version of a confusing category.',
    related: ['co2-fractional-laser'],
    publishedAt: '2026-09-02T09:00:00Z',
    ...AUTHOR,
    content: `Most people arrive having been told a laser will fix their skin, without ever being told which laser, or why. The category is genuinely confusing, so here is the short version.

## They are not interchangeable

Lasers are chosen by what they target. Pigment, blood vessels, hair and water all absorb light differently, and a device tuned for one is close to useless for another. A clinic offering "laser" as a single service is a clinic to ask harder questions of.

## The three you will most often be offered

**Pico** targets pigment. Ultra-short pulses shatter it mechanically rather than burning it, which puts less heat into the skin — the reason it is usually the safer choice on deeper skin tones.

**Diode** targets the hair follicle. It is a hair-reduction device. It will not do anything meaningful for pigmentation.

**Fractional resurfacing** targets water in the tissue to drive collagen remodelling. It is the heaviest of the three, with the most downtime, and the right answer for texture and scarring rather than tone. Ours is a [CO₂ fractional laser](/treatments/co2-fractional-laser/).

## Four questions worth asking any clinic

1. Which device, by name, and who operates it?
2. What is the patch-test protocol for my skin tone?
3. How many sessions, and what happens if I see no change after two?
4. What does the price cover — the session, or the course?

A clinic that answers all four without hesitating is a clinic that has thought about it. If the answer to the fourth is vague, ask again before you pay.

## The honest part

No laser will fix skin that is being undermined by sun exposure. SPF is not an upsell attached to the end of a treatment plan — it is the part of the plan that determines whether the rest of it holds.`,
  },
  {
    slug: 'questions-to-ask-any-clinic',
    title: 'Seven questions to ask any clinic before you book',
    seoTitle: '7 Questions to Ask Before Booking a Skin Clinic | The Better Face',
    metaDescription: 'The questions that separate a clinic from a counter: who treats you, what it really costs, what happens if it goes wrong. Print this and take it with you.',
    excerpt: 'You are allowed to interview a clinic. What to ask before you book, and what a good answer sounds like — from people who sit on the other side of the desk.',
    related: ['co2-fractional-laser', 'hifu'],
    publishedAt: '2026-08-18T09:00:00Z',
    ...AUTHOR,
    content: `You are allowed to interview a clinic. Most people do not, because the room is designed to make you feel like the decision has already been made. Here is what to ask, and what a good answer sounds like.

## 1. Who will actually perform the treatment?

Not who owns the clinic, not who did your consultation. The person holding the device. Ask for their registration number and their training on that specific machine. A good clinic answers this in one sentence without checking.

## 2. What device are you using, and why that one?

"A laser" is not an answer. Pigment, vessels, hair and water absorb light differently, and a device tuned for one is close to useless for another. If the answer is vague, the treatment plan is too.

## 3. What is the total cost, in writing, today?

Per session and for the whole course. The most common complaint in aesthetics is not a bad result — it is a bill that grew. Clear, itemised pricing and a written quote before booking should be the minimum.

## 4. What happens if it does not work?

Ask what the review point is, how many sessions in, and what the clinic does if you reach it without change. A plan with no review point is not a plan.

## 5. What are the side effects, and what is rare but serious?

Every real treatment has both. A clinic that only lists the mild ones has either not thought about it or has decided not to tell you.

## 6. Who do I call at 9pm if something goes wrong?

Complications are uncommon and almost all of them resolve quickly when treated early. The clinics worth trusting have a number and an answer.

## 7. Is there a reason I should not have this?

The most useful question on the list. If a clinic cannot name a single person they would turn away for this treatment, they are not assessing anyone.

## What a no sounds like

"That will not fix what is bothering you" is the most valuable sentence a clinician can say to you. It costs them the booking. If you never hear it from a clinic, that tells you something about how they decide.`,
  },
  {
    slug: 'spf-and-why-results-fade',
    title: 'Why your pigmentation came back',
    seoTitle: 'Why Pigmentation Returns After Laser | SPF & Aftercare | The Better Face',
    metaDescription: 'Pigmentation that returns is usually not treatment failure. It is sun, hormones, or heat. What actually holds a result, and what quietly undoes it.',
    excerpt: 'Someone finishes a course, the skin looks even, and four months later the patches are back. Almost always the treatment worked — something else undid it.',
    related: ['melasma-treatment', 'chemical-peel'],
    publishedAt: '2026-07-05T09:00:00Z',
    ...AUTHOR,
    content: `Someone finishes a course, the skin looks even, and four months later the patches are back. Almost always, the treatment worked. Something else undid it.

## Pigment cells are not removed, they are quietened

Laser and peels break down pigment that has already been made. They do not remove the cells that make it. Those cells are still there, still responsive, and still waiting for a trigger.

## The three triggers

**Ultraviolet light.** The obvious one, and the one people underestimate in a tropical climate. Incidental exposure — the walk to the car, the drive, the window seat — adds up to more annual UV than a beach holiday does.

**Hormones.** Melasma in particular is driven by oestrogen and progesterone. Pregnancy, the combined pill and some hormonal treatments will drive it back regardless of how good the laser was. This is why we ask.

**Heat.** Less well known and genuinely underrated. Cooking over a stove, hot yoga, a steam room — infrared and simple heat can provoke melasma without any UV at all.

## What actually holds a result

SPF 50, broad spectrum, every morning, reapplied if you are outdoors. That is the whole intervention, and it is the one people skip. Tinted formulations containing iron oxide do noticeably better against melasma because they block visible light as well as UV.

Then maintenance: a topical that keeps the cells quiet between courses, and a single session at the interval your clinician sets rather than waiting for the patches to come back first.

## What we will tell you at consultation

Melasma is managed, not cured. Our [non-invasive melasma program](/treatments/melasma-treatment/) is built around that honesty. If your pigmentation is hormonally driven, we will say so before you spend money, and we will set the expectation as control rather than clearance. Anyone promising otherwise is selling you something.`,
  },

  // ── new launch articles ──
  {
    slug: 'hifu-vs-thread-lift-vs-facelift',
    title: 'HIFU, thread lift or facelift? An honest comparison',
    seoTitle: 'HIFU vs Thread Lift vs Facelift: An Honest Comparison | The Better Face',
    metaDescription: 'What each lift actually does, how long results last, real downtime, and who each one suits — compared honestly by a clinic that only offers one of them.',
    excerpt: 'Three very different answers to the same mirror moment. What each one actually does, who it suits, and the trade-offs nobody puts on the poster.',
    related: ['hifu', 'exilis'],
    publishedAt: '2026-09-24T09:00:00Z',
    ...AUTHOR,
    content: `Somewhere in your late thirties or forties, the jawline softens and the mirror starts a conversation. The three answers you will be offered — HIFU, threads, surgery — are so different in mechanism, cost structure and commitment that comparing them on results alone misses the point. Here is the whole picture.

## What each one actually is

**HIFU** — high-intensity focused ultrasound — delivers heat to the deep support layer of the face without breaking the skin. The heat triggers your own collagen production, and the lift builds over roughly twelve weeks. Nothing is inserted and nothing is removed; [our HIFU treatment](/treatments/hifu/) is a single session for most faces.

**A thread lift** places dissolvable barbed sutures under the skin and pulls the tissue upward against them. The mechanical lift is immediate; the threads dissolve over months, leaving some collagen behind along their tracks.

**A facelift** is surgery. The support layer itself is repositioned and secured, excess skin is removed, and the result is measured in years rather than months.

## The honest results ladder

Surgery lifts most, by a distance. Threads sit in the middle — a visible but modest reposition that suits early jowling. HIFU is the subtlest of the three: firmer, tighter, lifted at the margins, and best described as turning the clock back a few years rather than re-engineering the face.

If a clinic tells you a machine will match a surgical result, they are overselling the machine.

## Downtime, risk and commitment

HIFU: mild tenderness for a few days, no marks, straight back to work. Threads: several days of swelling and tightness, with a small risk of dimpling or asymmetry while they settle. Surgery: weeks of recovery, a general anaesthetic, and the full set of surgical risks — traded for the largest and longest-lasting change.

## How long each lasts

Collagen from HIFU builds to a peak around three months and holds for a year or more; many people repeat it annually. Threads typically hold their lift for twelve to eighteen months. A good facelift is usually measured in seven to ten years.

## Who each one suits

Early, mild laxity with no appetite for needles or downtime: HIFU, sometimes alongside [Exilis](/treatments/exilis/) for skin quality. Moderate jowling in someone comfortable with a procedure: threads are worth a conversation. Significant laxity — folds you can gather with your fingers: surgery gives the only honest answer, and a machine would waste your money.

## Where we stand

We offer HIFU and not the other two, which is exactly why this comparison can be honest: when someone's laxity is past what ultrasound can do, we say so at consultation and point them toward a surgical consult instead of taking the booking. A lift you were talked into is not a result — it is a receipt.`,
  },
  {
    slug: 'non-surgical-hair-regrowth-guide',
    title: 'PRP, PDRN or exosomes? A plain guide to non-surgical hair regrowth',
    seoTitle: 'PRP vs PDRN vs Exosomes for Hair Loss | The Better Face',
    metaDescription: 'The three non-surgical hair treatments compared in plain language: how each works, what results are realistic, and the one thing none of them can do.',
    excerpt: 'Three names you will meet the moment you search "hair loss treatment". How each works, what is realistic, and the limit none of them can cross.',
    related: ['prp', 'hair-growth-pdrn', 'hair-regrowth-exosomes', 'scalp-anti-dandruff'],
    publishedAt: '2026-09-20T09:00:00Z',
    ...AUTHOR,
    content: `Hair loss is one of the most emotionally loaded things we treat, and the marketing around it takes full advantage. Before any comparison, one sentence matters more than the rest of this article: **these treatments support follicles that are still alive.** Where a follicle has been gone for years, nothing in this guide will bring it back — that conversation is about transplantation, and we will tell you so at assessment.

With that said honestly, here is what each option actually is.

## PRP: your own biology, concentrated

[PRP](/treatments/prp/) starts with a small draw of your own blood. We spin it down to concentrate the platelets — the fraction that carries your growth factors — and return it to the scalp where the thinning is. Because it comes from you, nothing foreign is introduced. It has the longest track record of the three, and results build over a short course of sessions, not overnight.

## PDRN: signalling repair

[PDRN](/treatments/hair-growth-pdrn/) is a regenerative polynucleotide used to stimulate the tissue around the follicle — the environment the hair grows out of. Think of it less as fertiliser for the hair and more as repair work on the soil. It is delivered as a course over several months and pairs naturally with the other two.

## Exosomes: the needle-free option

Exosomes are cell-derived signalling particles applied to the scalp. Ours is a strictly [needle-free, topical protocol](/treatments/hair-regrowth-exosomes/) — never injected, never microneedled — which makes it the most comfortable entry point, and the one we suggest for people who cannot face needles at all.

## So which one?

The honest answer is that they are not really rivals. PRP brings growth factors, PDRN repairs the environment, exosomes add signalling — clinics that get results usually sequence or combine them rather than crowning a winner. What decides the plan is your scalp: the pattern of thinning, how long it has been happening, and what the follicles look like on examination.

## Why the scalp itself comes first

A regrowth plan applied to an inflamed, congested scalp is money poured onto a blocked drain. If there is buildup, flaking or irritation, we settle it first with a [deep-cleansing scalp treatment](/treatments/scalp-anti-dandruff/) — unglamorous, inexpensive, and the reason the expensive part works.

## What a real plan looks like

An assessment with photographs, a defined course, a review point at three to four months against the baseline pictures, and a clinician willing to say "this is not working, let us change course." Anyone promising guaranteed regrowth, in any timeframe, is promising something biology does not.`,
  },
  {
    slug: 'glutathione-iv-drip-facts',
    title: 'Glutathione drips: what they do — and what they don’t',
    seoTitle: 'Glutathione IV Drips: Facts vs Hype | The Better Face',
    metaDescription: 'Glutathione drips are everywhere in the Philippines. A clinician separates what the antioxidant genuinely does from what the marketing claims for it.',
    excerpt: 'The most requested drip in the country, and the most oversold. What glutathione actually is, what the evidence supports, and how to have one safely.',
    related: ['glutathione-iv-drip'],
    publishedAt: '2026-09-16T09:00:00Z',
    ...AUTHOR,
    content: `No treatment in the Philippines is requested by name more often than the gluta drip, and none arrives with more baggage. Here is the version of this conversation we have in the consultation room, written down.

## What glutathione actually is

Glutathione is an antioxidant your body already makes — a tripeptide involved in neutralising oxidative stress and supporting normal detoxification pathways in the liver. It is not an exotic import; it is standard biochemistry. An [IV drip](/treatments/glutathione-iv-drip/) delivers it directly into circulation rather than through the gut.

## The whitening question, answered honestly

Most people asking about glutathione are asking about skin lightening, so let us not pretend otherwise. The theory is real — glutathione can nudge pigment production toward lighter pheomelanin — but the clinical evidence for dramatic, lasting whitening from IV glutathione is limited, results vary enormously between people, and any effect fades when the drips stop. The Philippine FDA has repeatedly cautioned against high-dose injectable glutathione marketed for whitening. A clinic that promises you a shade card is promising what the evidence does not.

## What a drip can reasonably offer

Framed honestly, a screened, clinician-run glutathione drip is a wellness treatment: antioxidant support, often combined with vitamin C and hydration, that many clients say leaves them feeling brighter and fresher — with any change in skin tone gradual, modest and temporary. If that framing sounds underwhelming next to the billboards, that is rather the point.

## Why screening is not a formality

IV anything deserves a medical gate. We check history, allergies, kidney function where indicated, G6PD status when relevant, and we do not treat pregnant or breastfeeding clients. The drip itself is the easy part; the screening is what you are actually paying a clinic for.

## The red flags worth walking away from

A drip administered in a mall kiosk with no medical screening. Doses escalated "for faster whitening". No clinician on site. No answer to the question "what is in the bag, exactly?" Cheap is not the risk — unaccountable is.

## Our position

We run glutathione drips as what they are: a screened, supervised wellness treatment inside a wider plan, with the marketing claims left at the door. If you want the honest version of this conversation applied to your own health picture, that is what the consultation is for.`,
  },
  {
    slug: 'co2-laser-aftercare-guide',
    title: 'CO₂ laser aftercare: the first seven days, day by day',
    seoTitle: 'CO2 Fractional Laser Aftercare: Day-by-Day Guide | The Better Face',
    metaDescription: 'What healing skin looks like on each day after CO₂ fractional laser, what to use, what to avoid, and the signs that mean you should call your clinic.',
    excerpt: 'The treatment takes an hour. The result is decided in the week that follows. What healing actually looks like, day by day, and what to do about it.',
    related: ['co2-fractional-laser', 'chemical-peel'],
    publishedAt: '2026-09-10T09:00:00Z',
    ...AUTHOR,
    content: `A [CO₂ fractional laser](/treatments/co2-fractional-laser/) session takes under an hour. The result — how much of the scarring softens, how even the skin heals — is substantially decided by what you do in the seven days after it. This is the week, honestly described.

## Day 0: the day of treatment

Expect the skin to feel hot and tight, like a strong sunburn, for a few hours. Redness is universal. Cool (not iced) compresses help; so does sleeping slightly propped up on a clean pillowcase. Use only what we sent you home with — this is not the week to experiment.

## Days 1–2: the rough stage

The treated area darkens and develops a fine, sandpapery grid — those are the micro-columns doing exactly what they should. Pinpoint swelling peaks around day two. Wash with the gentle cleanser we gave you, lukewarm water only, patting dry. Moisturise more often than feels necessary; healing skin drinks it.

## Days 3–4: the flaking begins

The grid starts to lift and flake, and this is where results are won or lost: **do not pick, peel or scrub.** Skin lifted before it is ready heals darker, and in warm, high-UV climates like ours that pigment can take months to fade. Let every flake fall on its own schedule.

## Days 5–7: fresh skin

New skin emerges — pink, smooth and noticeably sensitive. The redness settles over the following days to weeks depending on depth. Makeup is usually fine again around the end of this week once the surface is fully closed; we confirm at your check-in rather than leaving you to guess.

## The rules that do not change all week

SPF 50 every single morning, reapplied if you are outdoors — sun on healing skin is how good results turn into pigmentation problems. No actives (retinoids, acids, vitamin C) until we clear you. No gym, sauna or steam for the first several days; sweat and heat irritate the grid. Clean hands, clean pillowcase, and resist the mirror-picking hour at midnight.

## When to call us

Increasing pain after day two rather than decreasing. Spreading redness, honey-coloured crusting, or any cold-sore tingle if you are prone to them. All uncommon, all very manageable when treated early — and exactly why you should have a clinic that answers. You will have our number; use it without apologising.

## The part nobody says

Deeper scarring usually needs more than one session, spaced weeks apart, and the collagen keeps remodelling for months after the redness is gone. Judge the result at three months, not at day eight — and if a [lighter peel](/treatments/chemical-peel/) is the better tool for your skin, we will say so before you book a laser you do not need.`,
  },
];

await ensureSchema();
const { posts: existing } = await listPosts({ limit: 500 });
const have = new Set(existing.map((p) => p.slug));

let created = 0;
for (const p of POSTS) {
  if (have.has(p.slug)) { console.log('skip (exists):', p.slug); continue; }
  await createPost({ ...p, status: 'published' }, null);
  console.log('created:', p.slug);
  created++;
}
console.log(`\nSeed done — ${created} created, ${POSTS.length - created} already present.`);
process.exit(0);
