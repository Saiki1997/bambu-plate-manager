import assert from "node:assert/strict";
import test from "node:test";
import { parseDuration, parseOcrDocument, type OcrLine } from "./parse-slicing.ts";

function grams(row: { total: { grams: number | null } | null } | undefined): number | null {
  return row?.total?.grams ?? null;
}

test("duration parser keeps Bambu stamps and rejects noise", () => {
  assert.equal(parseDuration("16h5m"), "16h5m");
  assert.equal(parseDuration("9h22m"), "9h22m");
  assert.equal(parseDuration("1d18h53m"), "1d18h53m");
  assert.equal(parseDuration("52m55s"), "52m55s");
  assert.equal(parseDuration("5m21s"), "5m21s");
  assert.equal(parseDuration("5d8h12m"), "5d8h12m");
  assert.equal(parseDuration("h22m"), null);
  assert.equal(parseDuration("52m585s"), null);
});

test("multi-plate summary OCR repairs missing decimals", () => {
  const lines: OcrLine[] = [
    { text: "1 69.79m 340m 031m 815m 81.64 m" },
    { text: "211509 1030g 095g 24709 247.449" },
    { text: ".2 2012m 076m 0.79 m 195m 23.63 m" },
    { text: "61479 233g 242g 597g 7219g" },
    { text: "m4 11509m 627m 003m 173m 123.12 m" },
    { text: "351.559 19.15 011g 528g 376.099" },
    { text: "5 35946m 1896m 006m 311m 381.59 m" },
    { text: "1089.399g 5747g 0.19g 942g 1156479" },
    { text: "Total 56445m 2939m 120m 1494m 609.99 m" },
    { text: "1713919 89259 366g 45369 1852199" },
    { text: "Total eost: 37.03" },
    { text: "Time Estimation" },
    { text: "Plate 1 16h5m", duration: "16h5m" },
    { text: "Plate 2 6h12m", duration: "6h12m" },
    { text: "Plate 3 h22m", duration: "9h22m" },
    { text: "Plate 4 2h25m", duration: "2h25m" },
    { text: "Plate 5 15h57m", duration: "15h57m" },
    { text: "Plate 6 1d18h53m", duration: "1d18h53m" },
    { text: "Plate 7 23h26m", duration: "23h26m" },
    { text: "Plate 8 4h1m", duration: "4h1m" },
    { text: "Plate 9 3h37m", duration: "3h37m" },
    { text: "Plate 10 3h20m", duration: "3h20m" },
    { text: "Plate 11 52m55s", duration: "52m55s" },
    { text: "Total 5d8h12m", duration: "5d8h12m" },
  ];

  const doc = parseOcrDocument(lines);
  assert.equal(doc.layout, "multi-plate-summary");
  assert.equal(doc.cost, "37.03");
  assert.equal(doc.projectDuration, "5d8h12m");
  assert.equal(doc.plates.length, 11);
  assert.equal(doc.plates[2].label, "Plate 3");
  assert.equal(doc.plates[2].totalTime, "9h22m");
  assert.equal(doc.plates[2].needsReview, false);
  assert.equal(doc.plates[10].totalTime, "52m55s");

  const filaments = doc.rows.filter((row) => !row.isTotal);
  assert.deepEqual(
    filaments.map((row) => row.filamentId),
    ["1", "2", "4", "5"],
  );
  assert.equal(grams(filaments[0]), 247.44);
  assert.equal(filaments[0].model?.meters, 69.79);
  assert.equal(filaments[0].model?.grams, 211.5);
  assert.equal(filaments[0].support?.grams, 10.3);
  assert.equal(filaments[0].purged?.meters, 0.31);
  assert.equal(filaments[0].tower?.grams, 24.7);
  assert.equal(filaments[1].model?.meters, 20.12);
  assert.equal(filaments[1].total?.grams, 72.19);
  assert.equal(filaments[2].model?.meters, 115.09);
  assert.equal(filaments[2].model?.grams, 351.55);
  assert.equal(filaments[2].support?.grams, 19.15);
  assert.equal(filaments[2].purged?.grams, 0.11);
  assert.equal(filaments[2].total?.grams, 376.09);
  assert.equal(filaments[3].support?.meters, 18.96);
  assert.equal(filaments[3].support?.grams, 57.47);
  assert.equal(filaments[3].tower?.grams, 9.42);
  assert.equal(filaments[3].total?.grams, 1156.47);
  assert.ok(filaments.every((row) => row.needsReview === false));

  const total = doc.rows.find((row) => row.isTotal);
  assert.equal(total?.total?.grams, 1852.19);
  assert.equal(total?.total?.meters, 609.99);
  assert.equal(total?.model?.meters, 564.45);
  assert.ok(!doc.warnings.some((warning) => warning.includes("add up")));
});

test("single plate keeps three columns and the time block", () => {
  const doc = parseOcrDocument([
    { text: "Slicing Result" },
    { text: "Filament Model Support Total" },
    { text: "5 66.22 m 840m 74.62 m" },
    { text: "200.70 g 2546 g 226.15 g" },
    { text: "Filament change times: 0" },
    { text: "Cost: 4.52" },
    { text: "Prepare time: 5m21s" },
    { text: "Model printing time: 16h0m" },
    { text: "Total time: 16h5m" },
    { text: "Travel Retract Wipe Seams" },
  ]);

  assert.equal(doc.layout, "single-plate");
  assert.equal(doc.cost, "4.52");
  assert.equal(doc.filamentChanges, "0");
  assert.equal(doc.prepareTime, "5m21s");
  assert.equal(doc.printTime, "16h0m");
  assert.equal(doc.projectDuration, "16h5m");
  assert.equal(doc.plates.length, 1);
  assert.equal(doc.plates[0].totalTime, "16h5m");
  const row = doc.rows.find((item) => !item.isTotal);
  assert.equal(row?.filamentId, "5");
  assert.equal(row?.wide, false);
  assert.equal(row?.model?.meters, 66.22);
  assert.equal(row?.model?.grams, 200.7);
  assert.equal(row?.support?.meters, 8.4);
  assert.equal(row?.support?.grams, 25.46);
  assert.equal(row?.total?.meters, 74.62);
  assert.equal(row?.total?.grams, 226.15);
  assert.equal(row?.purged, null);
  assert.equal(row?.needsReview, false);
});

test("empty OCR does not invent plates or weights", () => {
  const doc = parseOcrDocument([{ text: "Options Display" }, { text: "" }]);
  assert.equal(doc.layout, "unknown");
  assert.equal(doc.rows.length, 0);
  assert.equal(doc.plates.length, 0);
  assert.equal(doc.cost, null);
});

test("live OCR text from the sample screenshots", () => {
  const single = parseOcrDocument([
    { text: "5 66.22 m 840m 7462 m" },
    { text: "200.70 g 25.46 g 226.15 g" },
    { text: "Gost: 4.52" },
    { text: "Tme stmato" },
    { text: "Peae tme: 5m21s" },
    { text: "Model tg tme: 16h0m" },
    { text: "Total tme: 16h5m" },
  ]);
  assert.equal(single.layout, "single-plate");
  assert.equal(single.cost, "4.52");
  assert.equal(single.prepareTime, "5m21s");
  assert.equal(single.printTime, "16h0m");
  assert.equal(single.projectDuration, "16h5m");
  assert.equal(single.rows[0]?.model?.grams, 200.7);
  assert.equal(single.rows[0]?.needsReview, false);

  const multi = parseOcrDocument([
    { text: "llamet Model ot Pged Toe Total" },
    { text: "1 69.79 m 340m 031m 815m 81.64 m" },
    { text: "211509 10309 095g 2470g 247.449" },
    { text: ". 2 2012m 076m 0.79 m 195m 2363 m" },
    { text: "6147 233g 242g 597g 72199" },
    { text: "m4 115.09m 627m 003m 173m 123.12 m" },
    { text: "351559 19.15 011g 528g 376.09 g" },
    { text: "5 359.46m 1896m 006m 311m 381.59 m" },
    { text: "1089.39g 5747g 019g 942g 1156.47g" },
    { text: "Total 56445m 2939m 120m 1494m 609.99 m" },
    { text: "1713919 89.259 3.669 45369 185219g" },
    { text: "Total eost: 37.03" },
    { text: "Tme stmatloo" },
    { text: "Plate 1 16h5m", duration: "16h5m" },
    { text: "Plate 3 9h22m", duration: "9h22m" },
    { text: "Plate 11 52m55s", duration: "52m55s" },
    { text: "Total 5d8h12m", duration: "5d8h12m" },
  ]);
  assert.equal(multi.layout, "multi-plate-summary");
  assert.equal(multi.cost, "37.03");
  assert.equal(multi.rows.filter((row) => !row.isTotal).length, 4);
  assert.equal(multi.rows[0]?.total?.grams, 247.44);
  assert.equal(multi.rows[1]?.model?.meters, 20.12);
  assert.equal(multi.rows[2]?.model?.meters, 115.09);
  assert.equal(multi.rows[3]?.tower?.grams, 9.42);
  assert.equal(multi.rows.find((row) => row.isTotal)?.total?.grams, 1852.19);
  assert.equal(multi.plates.find((plate) => plate.label === "Plate 3")?.totalTime, "9h22m");
  assert.equal(multi.projectDuration, "5d8h12m");
  assert.ok(multi.rows.every((row) => row.needsReview === false));
});

test("flags a metre reading whose weight is not physically plausible", () => {
  const doc = parseOcrDocument([
    { text: "2 202m 076m 0.79 m 195m 23.63 m" },
    { text: "6147g 233g 242g 597g 7219g" },
  ]);
  const row = doc.rows[0];
  assert.equal(row?.model?.meters, 2.02);
  assert.equal(row?.model?.grams, 61.47);
  assert.equal(row?.needsReview, true);
});
