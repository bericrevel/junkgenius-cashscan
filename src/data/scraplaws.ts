// Scrap-law field guide — general, stable, deliberately NON-state-specific.
//
// Rule #1 note: fifty states of specific statutes generated from an AI's
// memory would be exactly the kind of confidently-wrong "data" this app
// refuses to ship. What IS shippable honestly: the widely-true basics every
// scrapper runs into, the universal never-scrap list, and launchers to
// verify locally. The chat assistant backs this up — and it also refuses to
// invent state specifics.
//
// LAST REVIEWED: July 2026. If you're reading this a year later, re-review.

export const LAWS_REVIEWED = "July 2026";

export interface LawSection {
  title: string;
  body: string;
}

export const LAW_SECTIONS: LawSection[] = [
  {
    title: "What every yard will ask for",
    body: `Bring a government photo ID — nearly every US state requires yards to record seller identity, and most record your vehicle plate too. Many materials carry a "tag and hold" period (the yard holds the load some days before paying or processing) and some payments come as check or ATM voucher instead of cash, depending on state rules and the amount. None of this means trouble — it's routine anti-theft law. If you're asked, it's normal.`,
  },
  {
    title: "The never-scrap list",
    body: `Some items are presumed stolen and can put you in real legal trouble regardless of how you got them: utility wire and transformers, guardrails, manhole covers, storm grates, street signs, railroad metal, grave markers, beer kegs, shopping carts, and AC coils or units you can't show you own. If it looks like it belongs to a utility, a city, a railroad, or a business — it does. Walk away; a load of it isn't worth a charge.`,
  },
  {
    title: "Catalytic converters",
    body: `The most regulated item in scrap. After years of theft waves, most states now require proof of ownership — typically the vehicle title or a repair-shop record matching the converter — and many ban cash payment for them entirely. Selling a loose cat without paperwork ranges from "yard refuses" to "felony" depending on the state. If you legitimately scrap a whole vehicle, keep the title; that covers the converter.`,
  },
  {
    title: "Dumpster diving",
    body: `Legality is local, not statewide: it usually turns on trespass, not the trash. The workable rules of thumb — posted "No Trespassing" means no; locked or fenced means no; behind a business, ask first (many will say yes to save disposal fees); never make a mess; leave when asked. Some cities ban it outright by ordinance, so one town's fine is the next town's ticket.`,
  },
  {
    title: "Curb piles and bulk-trash day",
    body: `Curb set-outs are generally treated as abandoned property, and in most places taking them is tolerated or outright fine — but a minority of cities claim set-outs as municipal property once curbed (it funds their recycling), and scavenging ordinances exist. If a truck crew or a resident tells you no, that's your answer. Asking the homeowner takes ten seconds and has a near-perfect yes rate.`,
  },
  {
    title: "How to verify your state's rules",
    body: `Two reliable sources beat any app: (1) your scrap yard — the law binds THEM, so they know exactly what ID, holds, and payment rules apply, and they'll tell you on the phone; (2) your state's own website. Use the buttons below to search official sources, and treat anything else (including this guide and the chat) as orientation, not legal advice.`,
  },
];
