// Draws a verifier pack (lib/verifier-pack.ts) as a PDF with @react-pdf/renderer.
//
// Server only. Used by /more/verifier-pack/pdf (on demand) and
// /api/cron/verifier-pack (the monthly copy), so both give the same file.
//
// Readable in black and white: nothing relies on colour. Out-of-range rows
// have a thick left bar, a grey background and the words OUT OF RANGE;
// missing days say NO RECORD in a dashed box.
//
// Page numbers in the contents: the document is drawn twice. In the first
// pass each section heading writes down the page it lands on; the second
// pass prints those numbers. The contents always take the same number of
// pages (lib/verifier-pack.ts splits them itself), so nothing moves.

import "server-only";

import path from "node:path";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { aucklandDate, aucklandTime } from "@/lib/dates";
import {
  BUSINESS_NAME,
  contentsItems,
  contentsPages,
  longDate,
  packTotals,
  pageRefs,
  rangeLabel,
  sameMarkers,
  shortDate,
  SICKNESS_ID,
  TRAINING_ID,
  type ContentsItem,
  type Pack,
  type PackDay,
  type PackRow,
  type PackSection,
} from "@/lib/verifier-pack";

export type PackMeta = {
  /** "Mia Patel (manager)" or "Chutneys Ops (automatic monthly copy)". */
  generatedBy: string;
  generatedAt: Date;
  /** Shown under the title, e.g. "Monthly copy: October 2026". */
  subtitle?: string;
};

// ---- Fonts --------------------------------------------------------------------------

// Inter (SIL Open Font License, assets/fonts/OFL.txt). The PDF's built-in
// fonts can't show Māori macrons ("Māngere"); Inter can, and it's the app's font.
let fontsReady = false;
function registerFonts() {
  if (fontsReady) return;
  const dir = path.join(process.cwd(), "assets", "fonts");
  Font.register({
    family: "Inter",
    fonts: [
      { src: path.join(dir, "Inter-Regular.ttf"), fontWeight: 400 },
      { src: path.join(dir, "Inter-Bold.ttf"), fontWeight: 700 },
    ],
  });
  // Never split words with hyphens: names and values must read exactly.
  Font.registerHyphenationCallback((word) => [word]);
  fontsReady = true;
}

// ---- Styles (black, white and greys only) ----------------------------------------------
// lineHeight set on the page is passed down as a fixed size, so every text
// bigger than the body sets its own (or lines overlap).

/** A4 in points (react-pdf's unit). */
const A4_HEIGHT = 842;

const INK = "#000000";
const GREY = "#555555";
const RULE = "#999999";
const SHADE = "#e6e6e6";

const s = StyleSheet.create({
  page: { fontFamily: "Inter", fontSize: 8.5, color: INK, paddingTop: 36, paddingBottom: 54, paddingHorizontal: 36, lineHeight: 1.3 },
  // Placed from the top: with `bottom`, react-pdf misplaces a fixed footer
  // holding page-number text (it drifts off the page, then the PDF fails).
  footer: {
    position: "absolute",
    top: A4_HEIGHT - 34,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    color: GREY,
    borderTop: `0.5pt solid ${RULE}`,
    paddingTop: 4,
  },
  bold: { fontWeight: 700 },
  muted: { color: GREY },

  coverTitle: { fontSize: 26, lineHeight: 1.2, fontWeight: 700, marginTop: 90 },
  coverSub: { fontSize: 14, lineHeight: 1.3, marginTop: 6 },
  coverBusiness: { fontSize: 18, lineHeight: 1.3, fontWeight: 700, marginTop: 28 },
  facts: { marginTop: 22, borderTop: `1pt solid ${INK}` },
  fact: { flexDirection: "row", borderBottom: `0.5pt solid ${RULE}`, paddingVertical: 5 },
  factLabel: { width: 110, fontWeight: 700 },
  factValue: { flex: 1 },
  legendTitle: { fontSize: 11, lineHeight: 1.3, fontWeight: 700, marginTop: 26, marginBottom: 4 },
  legendLine: { marginTop: 3 },

  h1: { fontSize: 16, lineHeight: 1.3, fontWeight: 700, marginBottom: 4 },
  h2: { fontSize: 12, lineHeight: 1.3, fontWeight: 700, marginTop: 14, marginBottom: 2 },
  sectionNote: { color: GREY, marginBottom: 6 },

  tocRow: { flexDirection: "row", alignItems: "flex-end", paddingVertical: 3.5, borderBottom: `0.5pt dotted ${RULE}` },
  tocTitle0: { fontWeight: 700, fontSize: 10, lineHeight: 1.3 },
  tocTitle1: { paddingLeft: 14 },
  tocNote: { flex: 1, color: GREY, fontSize: 7.5, paddingLeft: 8 },
  tocPage: { width: 40, textAlign: "right", fontWeight: 700 },

  day: { marginTop: 8 },
  dayHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: SHADE,
    borderTop: `1pt solid ${INK}`,
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  thead: { flexDirection: "row", borderBottom: `1pt solid ${INK}`, paddingVertical: 2, fontWeight: 700 },
  row: { flexDirection: "row", borderBottom: `0.5pt solid ${RULE}`, paddingVertical: 3 },
  rowOut: { backgroundColor: SHADE, borderLeft: `3pt solid ${INK}` },
  rowSub: { borderLeft: `1.5pt dashed ${INK}`, marginLeft: 10 },
  cTime: { width: 62, paddingHorizontal: 4 },
  cBy: { width: 72, paddingHorizontal: 4 },
  cValues: { flex: 3, paddingHorizontal: 4 },
  cNotes: { flex: 2, paddingHorizontal: 4 },
  tag: { fontSize: 7, fontWeight: 700, letterSpacing: 0.5 },
  missing: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    border: `1pt dashed ${INK}`,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  // Closed: a thin solid grey border, so it never looks like NO RECORD.
  closed: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    border: `0.5pt solid ${RULE}`,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  missingDate: { width: 170, fontWeight: 700 },
  missingTag: { width: 80, fontWeight: 700, letterSpacing: 0.5 },

  marker: { fontSize: 1, height: 1 },
  tCell: { flex: 1, paddingHorizontal: 4 },
  personHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: SHADE,
    marginTop: 6,
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  para: { marginBottom: 6 },
  empty: { marginTop: 6, color: GREY },
});

function dateTime(iso: string): string {
  const d = new Date(iso);
  return `${shortDate(aucklandDate(d))}, ${aucklandTime(d)}`;
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

// ---- Pieces ----------------------------------------------------------------------------------

function Footer({ pack }: { pack: Pack }) {
  return (
    <View style={s.footer} fixed>
      <Text>
        {BUSINESS_NAME} · Food safety records · {rangeLabel(pack.from, pack.to)}
      </Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

function Cover({ pack, meta }: { pack: Pack; meta: PackMeta }) {
  const totals = packTotals(pack);
  const siteNames = pack.parts.map((p) => p.site.name).join(", ") || "No sites with records";
  const facts: [string, string][] = [
    ["Business", BUSINESS_NAME],
    [pack.allSites ? "Sites" : "Site", pack.allSites ? `All sites: ${siteNames}` : siteNames],
    ["Period", `${longDate(pack.from)} to ${longDate(pack.to)}`],
    ["Generated by", meta.generatedBy],
    ["Generated", `${longDate(aucklandDate(meta.generatedAt))}, ${aucklandTime(meta.generatedAt)} (NZ time)`],
    [
      "In this pack",
      `${plural(totals.entries, "entry", "entries")}, ${totals.outOfRange} out of range, ` +
        `${plural(totals.missingDays, "day")} with no record, ${plural(totals.unsignedDays, "sheet")} not signed off`,
    ],
  ];
  return (
    <Page size="A4" style={s.page}>
      <Text style={s.coverTitle}>Food safety records</Text>
      <Text style={s.coverSub}>{meta.subtitle ?? "Verifier pack"}</Text>
      <Text style={s.coverBusiness}>{BUSINESS_NAME}</Text>
      <View style={s.facts}>
        {facts.map(([label, value]) => (
          <View key={label} style={s.fact}>
            <Text style={s.factLabel}>{label}</Text>
            <Text style={s.factValue}>{value}</Text>
          </View>
        ))}
      </View>
      <Text style={s.legendTitle}>How to read this pack</Text>
      <Text style={s.legendLine}>Times are New Zealand time. Temperatures are in °C.</Text>
      <Text style={s.legendLine}>
        Each day&apos;s sheet lists every entry: the time, the values recorded, who recorded it and any comments.
      </Text>
      <Text style={s.legendLine}>
        OUT OF RANGE (thick bar, shaded row) marks a reading outside its limit, with the corrective action taken.
      </Text>
      <Text style={s.legendLine}>
        Entries can&apos;t be edited or deleted. A CORRECTION is a new entry, shown under the entry it corrects with the
        reason. LATER READING rows are follow-up readings for the same batch (cooling, batter).
      </Text>
      <Text style={s.legendLine}>
        NO RECORD (dashed box) means a record that must be done every day had no entry on a day the site trades.
        CLOSED (thin box) is a day the site doesn&apos;t trade, so nothing was expected.
      </Text>
      <Text style={s.legendLine}>Each sheet shows who signed it off and when (manager PIN), or NOT SIGNED OFF.</Text>
      <Footer pack={pack} />
    </Page>
  );
}

function ContentsPage({
  pack,
  items,
  refs,
  first,
}: {
  pack: Pack;
  items: ContentsItem[];
  refs: Record<string, number | null>;
  first: boolean;
}) {
  return (
    <Page size="A4" style={s.page}>
      <Text style={s.h1}>{first ? "Contents" : "Contents (continued)"}</Text>
      {items.map((item) => (
        <View key={item.id} style={s.tocRow}>
          <Text style={item.level === 0 ? s.tocTitle0 : s.tocTitle1}>{item.title}</Text>
          <Text style={s.tocNote}>{item.note}</Text>
          <Text style={s.tocPage}>{refs[item.id] ?? "–"}</Text>
        </View>
      ))}
      <Footer pack={pack} />
    </Page>
  );
}

/** Called with each heading's page during drawing (for the contents). */
type NotePage = (id: string, page: number) => void;

/** A heading that notes which page it ends up on (for the contents). */
function Marked({
  id,
  text,
  style,
  notePage,
}: {
  id: string;
  text: string;
  style: (typeof s)[keyof typeof s];
  notePage: NotePage;
}) {
  // react-pdf reports the page to a `render` callback, but doesn't paint
  // render-text that isn't `fixed`. So a tiny invisible marker reports the
  // page, and the heading is ordinary text. wrap={false} keeps the two on
  // the same page; minPresenceAhead moves them on if no rows would follow.
  return (
    <View wrap={false} minPresenceAhead={110}>
      <Text
        style={s.marker}
        render={({ pageNumber }) => {
          notePage(id, pageNumber);
          return "";
        }}
      />
      <Text style={style}>{text}</Text>
    </View>
  );
}

function Row({ row }: { row: PackRow }) {
  const sub = row.kind !== "entry";
  const style = [s.row, ...(sub ? [s.rowSub] : []), ...(row.outOfRange ? [s.rowOut] : [])];
  return (
    <View style={style} wrap={false}>
      <View style={s.cTime}>
        <Text style={s.bold}>{row.time}</Text>
        {row.kind === "correction" && <Text style={s.tag}>CORRECTION</Text>}
        {row.kind === "later" && <Text style={s.tag}>LATER READING</Text>}
      </View>
      <Text style={s.cBy}>{row.by}</Text>
      <View style={s.cValues}>
        {row.relation && <Text style={s.muted}>{row.relation}</Text>}
        {row.values.map((v) => (
          <Text key={v.label}>
            {v.label}: <Text style={v.out ? s.bold : {}}>{v.text}</Text>
            {v.out ? <Text style={s.bold}> (out of range)</Text> : null}
          </Text>
        ))}
        {row.values.length === 0 && <Text style={s.muted}>No values</Text>}
      </View>
      <View style={s.cNotes}>
        {row.outOfRange && <Text style={s.tag}>OUT OF RANGE</Text>}
        {row.outOfRange && (
          <Text>
            <Text style={s.bold}>Corrective action: </Text>
            {row.correctiveAction ?? "None recorded"}
          </Text>
        )}
        {!row.outOfRange && row.correctiveAction && <Text>Action: {row.correctiveAction}</Text>}
        {row.comment && (
          <Text>
            <Text style={s.bold}>{row.kind === "correction" ? "Reason: " : "Comment: "}</Text>
            {row.comment}
          </Text>
        )}
      </View>
    </View>
  );
}

/** Days with this many rows or fewer never split across pages. */
const KEEP_DAY_TOGETHER = 8;

function Day({ day }: { day: PackDay }) {
  if (day.status === "closed") {
    return (
      <View style={s.closed} wrap={false}>
        <Text style={s.missingDate}>{longDate(day.date)}</Text>
        <Text style={s.missingTag}>CLOSED</Text>
        <Text style={s.muted}>Not a trading day for this site.</Text>
      </View>
    );
  }
  if (day.status === "missing") {
    return (
      <View style={s.missing} wrap={false}>
        <Text style={s.missingDate}>{longDate(day.date)}</Text>
        <Text style={s.missingTag}>NO RECORD</Text>
        <Text style={s.muted}>
          {day.siteUsed ? "Staff chose this site that day." : "Nobody chose this site in the app that day."}
        </Text>
      </View>
    );
  }
  const signed = day.signedOff ? `Signed off by ${day.signedOff.by}, ${dateTime(day.signedOff.at)}` : "NOT SIGNED OFF";
  // A short day is one unbreakable block: it moves to the next page whole,
  // so its header is never left at the bottom of a page without its rows.
  // A long day may split; then its header repeats on each page (fixed).
  return (
    <View style={s.day} wrap={day.rows.length > KEEP_DAY_TOGETHER}>
      {/* fixed inside the day: repeats at the top of each page the day spans */}
      <View style={s.dayHead} fixed>
        <Text style={s.bold}>{longDate(day.date)}</Text>
        <Text style={day.signedOff ? {} : s.bold}>{signed}</Text>
      </View>
      <View style={s.thead} fixed>
        <Text style={s.cTime}>Time</Text>
        <Text style={s.cBy}>Recorded by</Text>
        <Text style={s.cValues}>Values</Text>
        <Text style={s.cNotes}>Actions and comments</Text>
      </View>
      {day.rows.map((row) => (
        <Row key={row.id} row={row} />
      ))}
    </View>
  );
}

function Section({ section, notePage }: { section: PackSection; notePage: NotePage }) {
  const c = section.counts;
  const note = [
    plural(c.entries, "entry", "entries"),
    `${c.outOfRange} out of range`,
    ...(section.required ? [`${plural(c.missingDays, "day")} with no record`] : []),
    ...(c.closedDays ? [`${plural(c.closedDays, "day")} closed`] : []),
    `${plural(c.unsignedDays, "sheet")} not signed off`,
  ].join(" · ");
  // The heading, its note and the first day (when it's short) are one
  // unbreakable block, so a heading is never left alone at the bottom of a
  // page. A long first day splits on its own, under a heading that moves
  // with it if fewer than ~110 points are left (minPresenceAhead in Marked).
  const [firstDay, ...rest] = section.days;
  const keepFirst = firstDay && (firstDay.status !== "recorded" || firstDay.rows.length <= KEEP_DAY_TOGETHER);
  return (
    <View>
      <View wrap={false}>
        <Marked id={section.id} text={section.title} style={s.h2} notePage={notePage} />
        <Text style={s.sectionNote}>
          {section.required ? "Must be done every day. " : "Done when it happens. "}
          {note}
        </Text>
        {keepFirst && <Day day={firstDay} />}
      </View>
      {(keepFirst ? rest : section.days).map((day) => (
        <Day key={day.date} day={day} />
      ))}
    </View>
  );
}

function Sickness({ pack, notePage }: { pack: Pack; notePage: NotePage }) {
  return (
    <View>
      <Marked id={SICKNESS_ID} text="Staff sickness (food safety exclusions)" style={s.h1} notePage={notePage} />
      <Text style={s.para}>
        Staff who reported vomiting or diarrhoea are excluded from handling food until a manager clears them (48 hours
        free of symptoms). All sites: staff work across sites. No medical details are kept in this pack.
      </Text>
      {pack.sickness.length === 0 ? (
        <Text style={s.empty}>No exclusions in this period.</Text>
      ) : (
        <View>
          <View style={s.thead} fixed>
            <Text style={s.tCell}>Name</Text>
            <Text style={s.tCell}>Date sick</Text>
            <Text style={s.tCell}>Date cleared</Text>
            <Text style={s.tCell}>Cleared by</Text>
          </View>
          {pack.sickness.map((r, i) => (
            <View key={i} style={s.row} wrap={false}>
              <Text style={s.tCell}>{r.name}</Text>
              <Text style={s.tCell}>{shortDate(r.dateSick)}</Text>
              <Text style={[s.tCell, ...(r.dateCleared ? [] : [s.bold])]}>
                {r.dateCleared ? shortDate(r.dateCleared) : "NOT CLEARED YET"}
              </Text>
              <Text style={s.tCell}>{r.clearedBy ?? "–"}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function Training({ pack, notePage }: { pack: Pack; notePage: NotePage }) {
  return (
    <View>
      <Marked id={TRAINING_ID} text="Training records" style={s.h1} notePage={notePage} />
      <Text style={s.para}>
        Everyone who worked in this period (chose a site or had a timesheet), with all their training up to{" "}
        {longDate(pack.to)}, whenever it was given. The trainer signs by recording it on their own login; the trainee
        confirms on theirs.
      </Text>
      {pack.training.length === 0 ? (
        <Text style={s.empty}>Nobody worked in this period.</Text>
      ) : (
        <View>
          <View style={s.thead} fixed>
            <Text style={s.tCell}>Date</Text>
            <Text style={[s.tCell, { flex: 1.6 }]}>Topic</Text>
            <Text style={s.tCell}>Trainer (signed)</Text>
            <Text style={s.tCell}>Trainee confirmed</Text>
          </View>
          {pack.training.map((person) => (
            <View key={person.name} minPresenceAhead={40}>
              <View style={s.personHead} wrap={false}>
                <Text style={s.bold}>{person.name}</Text>
                <Text>{plural(person.records.length, "record")}</Text>
              </View>
              {person.records.length === 0 && (
                <View style={s.row} wrap={false}>
                  <Text style={[s.tCell, s.bold]}>No training recorded</Text>
                </View>
              )}
              {person.records.map((r, i) => (
                <View key={i} style={s.row} wrap={false}>
                  <Text style={s.tCell}>{shortDate(r.date)}</Text>
                  <Text style={[s.tCell, { flex: 1.6 }]}>{r.topic}</Text>
                  <Text style={s.tCell}>
                    {r.trainer}
                    {"\n"}
                    <Text style={s.muted}>{dateTime(r.trainerSignedAt)}</Text>
                  </Text>
                  <Text style={[s.tCell, ...(r.traineeSignedAt ? [] : [s.bold])]}>
                    {r.traineeSignedAt ? dateTime(r.traineeSignedAt) : "NOT CONFIRMED YET"}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function PackDocument({
  pack,
  meta,
  refs,
  notePage,
}: {
  pack: Pack;
  meta: PackMeta;
  refs: Record<string, number | null>;
  notePage: NotePage;
}) {
  const pages = contentsPages(contentsItems(pack));
  return (
    <Document title={`${BUSINESS_NAME} food safety records, ${rangeLabel(pack.from, pack.to)}`} author={BUSINESS_NAME} creator="Chutneys Ops">
      <Cover pack={pack} meta={meta} />
      {pages.map((items, i) => (
        <ContentsPage key={i} pack={pack} items={items} refs={refs} first={i === 0} />
      ))}
      <Page size="A4" style={s.page}>
        {pack.parts.length === 0 && <Text style={s.empty}>No food safety records for this period.</Text>}
        {pack.parts.map((part, i) => (
          <View key={part.id} break={i > 0}>
            <Marked
              id={part.id}
              text={part.site.active ? part.site.name : `${part.site.name} (closed)`}
              style={s.h1}
              notePage={notePage}
            />
            <Text style={s.sectionNote}>
              {plural(part.counts.entries, "entry", "entries")} · {part.counts.outOfRange} out of range ·{" "}
              {plural(part.counts.missingDays, "day")} with no record
            </Text>
            {part.sections.map((section) => (
              <Section key={section.id} section={section} notePage={notePage} />
            ))}
          </View>
        ))}
        <Footer pack={pack} />
      </Page>
      {/* Their own pages, so each starts on a fresh page. (A `break` on a
          View here trips a react-pdf layout bug with some data.) */}
      <Page size="A4" style={s.page}>
        <Sickness pack={pack} notePage={notePage} />
        <Footer pack={pack} />
      </Page>
      <Page size="A4" style={s.page}>
        <Training pack={pack} notePage={notePage} />
        <Footer pack={pack} />
      </Page>
    </Document>
  );
}

/** The finished PDF. Draws until the section pages stop moving (twice in
 *  practice; a third pass is a safety net). */
export async function renderPackPdf(pack: Pack, meta: PackMeta): Promise<Buffer> {
  registerFonts();
  const items = contentsItems(pack);
  let markers: Record<string, number> = {};
  let pdf: Buffer | null = null;
  for (let pass = 0; pass < 3; pass++) {
    const seen: Record<string, number> = {};
    pdf = await renderToBuffer(<PackDocument pack={pack} meta={meta} refs={pageRefs(items, markers)} notePage={(id, page) => (seen[id] = page)} />);
    if (pass > 0 && sameMarkers(markers, seen)) break;
    markers = seen;
  }
  return pdf!;
}
