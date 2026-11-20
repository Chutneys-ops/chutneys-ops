// One short line a day on Home, the same for everyone, picked by the
// Auckland date. Written for this app: hospitality and teamwork, no quotes
// from real people, no religion or politics. Add or change lines freely;
// the order sets which day gets which line.

export const DAILY_MESSAGES: readonly string[] = [
  "Every plate that leaves the pass is a promise kept.",
  "A clean bench is a quiet thank-you to the next shift.",
  "The best service feels easy because someone prepared well.",
  "Small checks done on time keep big problems away.",
  "A warm hello costs nothing and makes someone's day.",
  "Taste, adjust, taste again. Care shows up on the plate.",
  "Busy is better when everyone knows where the next hand is needed.",
  "The fridge log is boring right up until it saves the day.",
  "Good food starts with clean hands and a calm head.",
  "Ask for help early. Nobody wins a rush alone.",
  "Every regular was once a first-time guest someone looked after.",
  "Label it, date it, and future you will be grateful.",
  "A steady pace beats a frantic one by the end of the night.",
  "The dosa is only as good as the batter someone minded yesterday.",
  "Say it twice in a rush: heard, and on it.",
  "A tidy station is a faster station.",
  "Kindness to a teammate is part of the job, not extra to it.",
  "Guests remember how you made them feel long after the meal.",
  "Fresh stock, first out. Rotation is a habit, not a chore.",
  "When in doubt about a temperature, check it. Then check it again.",
  "Leave the truck the way you'd like to find it tomorrow.",
  "A good handover is half of a good shift.",
  "Every allergen question deserves a careful answer.",
  "Quiet moments are for wiping down and stocking up.",
  "The smell of spices in the morning means the day has started well.",
  "Smile at the window. It travels further than you think.",
  "Hot food hot, cold food cold, and everyone goes home happy.",
  "Teach someone one small trick today.",
  "Mistakes get fixed faster when they're said out loud.",
  "A full float and a charged EFTPOS make for a calm open.",
  "Hospitality is noticing the little thing before anyone asks.",
  "Prep well, and service takes care of itself.",
  "The team that cleans together closes on time together.",
  "Check the date, check the seal, then serve with confidence.",
  "Great flavour comes from patience as much as from spice.",
  "Thank the dishwasher. Seriously.",
  "Every order is someone's lunch break. Make it count.",
  "Calm voices make a busy kitchen feel smaller.",
  "Write it down: a record kept is a worry gone.",
  "A good day is one where everyone goes home safe.",
  "Fresh coriander, sharp knives, steady hands.",
  "The first customer of the day sets the tone. Make it a good one.",
  "Sharing the load makes the long shifts shorter.",
  "Wash, rinse, sanitise. Simple steps, every time.",
  "There is always time to do it right the first time.",
  "Good service is a team sport played in small passes.",
  "A cheerful kitchen cooks better food.",
  "Spot a spill, sort a spill.",
  "The best compliment is a guest who comes back.",
  "Every site is part of one family. Look out for each other.",
  "Cool it quickly, store it safely, use it wisely.",
  "Be the teammate you'd want next to you on a Friday night.",
  "A clear walk-in is a happy walk-in.",
  "Take your breaks. Rested people make fewer mistakes.",
  "Pride in the small jobs shows in the big ones.",
  "One more wipe of the counter never hurt anyone.",
  "The rush always ends. The care you showed stays.",
  "Feeling unwell? Say so. Keeping each other safe comes first.",
  "Welcome every guest like they've come a long way to see you.",
  "Well done today. Tomorrow starts with a clean kitchen tonight.",
];

/** Whole days since 1970-01-01 for a "YYYY-MM-DD" date (no time zone involved). */
function dayNumber(ymd: string): number {
  return Math.floor(Date.parse(`${ymd}T00:00:00Z`) / 86_400_000);
}

/**
 * The message for an Auckland date ("YYYY-MM-DD"). The same all day for
 * everyone, a different one the next day, and back to the start after the
 * last line.
 */
export function pickMessage(ymd: string, messages: readonly string[] = DAILY_MESSAGES): string {
  if (messages.length === 0) return "";
  const n = dayNumber(ymd);
  if (Number.isNaN(n)) return messages[0];
  // ((n % len) + len) % len stays positive even for dates before 1970.
  return messages[((n % messages.length) + messages.length) % messages.length];
}
