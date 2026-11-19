// Calendar (ICS) parsing and repeats. Local time is pinned to New York so all-day and floating times are deterministic.
process.env.TZ = 'America/New_York';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseIcs, occurrences, joinLink } from './desktop/ics.mjs';

const ICS = fs.readFileSync(new URL('./fixtures/calendar.ics', import.meta.url), 'utf8');
const cal = (...ev) => ['BEGIN:VCALENDAR', ...ev.flatMap(e => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
const iso = d => d.toISOString();

test('parse: counts, fields, folding, escapes, TZID, UTC and all-day', () => {
  const ev = parseIcs(ICS);
  assert.equal(ev.length, 4);
  const [single, allDay, weekly, tz] = ev;
  assert.equal(single.uid, 'single-1@example.com');
  assert.equal(single.title, 'Stand-up');
  assert.equal(iso(single.start), '2026-11-24T15:00:00.000Z');
  assert.equal(iso(single.end), '2026-11-24T15:15:00.000Z');
  assert.equal(single.where, 'Room 1');
  assert.equal(single.text, 'Notes: https://example.com/notes', 'the alarm DESCRIPTION does not replace the event one');
  assert.equal(single.allDay, false); assert.equal(single.rrule, null); assert.deepEqual(single.exdates, []);
  assert.equal(allDay.allDay, true);
  assert.equal(iso(allDay.start), '2026-11-24T05:00:00.000Z', 'local midnight');
  assert.equal(iso(allDay.end), '2026-11-25T05:00:00.000Z');
  assert.equal(weekly.rrule.freq, 'WEEKLY'); assert.deepEqual(weekly.rrule.byday, ['MO', 'WE', 'FR']);
  assert.equal(weekly.exdates.length, 1); assert.equal(iso(weekly.exdates[0]), '2026-11-23T14:00:00.000Z');
  assert.equal(tz.title, 'Review, part 2');
  assert.equal(iso(tz.start), '2026-11-24T19:00:00.000Z', '14:00 New York in November is 19:00 UTC');
  assert.match(tz.text, /\nJoin: https:\/\/teams\.microsoft\.com\/l\/meetup-join\/abcdef$/);
});

test('occurrences: a fixed two-day window, in order, the excluded date skipped, all-day first', () => {
  const ev = parseIcs(ICS);
  const got = occurrences(ev, new Date(2026, 10, 23), new Date(2026, 10, 25));
  assert.deepEqual(got.map(o => [o.title, iso(o.start)]), [
    ['Team offsite', '2026-11-24T05:00:00.000Z'],
    ['Stand-up', '2026-11-24T15:00:00.000Z'],
    ['Review, part 2', '2026-11-24T19:00:00.000Z'],
  ]);
  assert.equal(got[2].join, 'https://teams.microsoft.com/l/meetup-join/abcdef');
  assert.equal(got[1].join, null);
  assert.equal(got[0].allDay, true);
  const later = occurrences(ev, new Date(2026, 10, 25), new Date(2026, 10, 28));
  assert.deepEqual(later.map(o => [o.title, iso(o.start)]), [['Planning', '2026-11-25T14:00:00.000Z'], ['Planning', '2026-11-27T14:00:00.000Z']]);
  assert.equal(iso(later[0].end), '2026-11-25T14:30:00.000Z');
});

test('repeats keep the wall-clock time across a daylight-saving change', () => {
  const ev = parseIcs(cal(['UID:d1', 'SUMMARY:Sync', 'DTSTART;TZID=America/New_York:20261026T090000', 'DTEND;TZID=America/New_York:20261026T093000', 'RRULE:FREQ=WEEKLY']));
  const got = occurrences(ev, new Date(Date.UTC(2026, 9, 25)), new Date(Date.UTC(2026, 10, 4)));
  assert.deepEqual(got.map(o => iso(o.start)), ['2026-10-26T13:00:00.000Z', '2026-11-02T14:00:00.000Z']); // 09:00 EDT, then 09:00 EST
  // the same in a zone other than the local one (London changes on 25 October)
  const lon = parseIcs(cal(['UID:d2', 'SUMMARY:Sync', 'DTSTART;TZID=Europe/London:20261019T090000', 'RRULE:FREQ=DAILY;INTERVAL=7;COUNT=3']));
  assert.deepEqual(occurrences(lon, new Date(Date.UTC(2026, 9, 1)), new Date(Date.UTC(2026, 11, 1))).map(o => iso(o.start)), ['2026-10-19T08:00:00.000Z', '2026-10-26T09:00:00.000Z', '2026-11-02T09:00:00.000Z']);
});

test('Windows zone names map to IANA; an unknown TZID is treated as local time and still shown', () => {
  const rows = [['Eastern Standard Time', '2026-11-24T14:00:00.000Z'], ['Sri Lanka Standard Time', '2026-11-24T03:30:00.000Z'], ['India Standard Time', '2026-11-24T03:30:00.000Z'], ['UTC', '2026-11-24T09:00:00.000Z'],
    ['GMT Standard Time', '2026-11-24T09:00:00.000Z'], ['Pacific Standard Time', '2026-11-24T17:00:00.000Z'], ['Central Standard Time', '2026-11-24T15:00:00.000Z'], ['Mountain Standard Time', '2026-11-24T16:00:00.000Z'],
    ['W. Europe Standard Time', '2026-11-24T08:00:00.000Z'], ['Singapore Standard Time', '2026-11-24T01:00:00.000Z'], ['China Standard Time', '2026-11-24T01:00:00.000Z'], ['Tokyo Standard Time', '2026-11-24T00:00:00.000Z'],
    ['AUS Eastern Standard Time', '2026-11-23T22:00:00.000Z'], ['"Mars/Olympus Mons"', '2026-11-24T14:00:00.000Z']];
  for (const [z, want] of rows) {
    const [e] = parseIcs(cal(['UID:z', 'SUMMARY:Call', `DTSTART;TZID=${z}:20261124T090000`]));
    assert.equal(iso(e.start), want, z);
  }
  const [u] = parseIcs(cal(['UID:z', 'SUMMARY:Call', 'DTSTART;TZID=Nowhere/Land:20261124T090000', 'DTEND;TZID=Nowhere/Land:20261124T100000']));
  assert.equal(occurrences([u], new Date(2026, 10, 24), new Date(2026, 10, 25)).length, 1);
});

test('repeats: daily with UNTIL, monthly, COUNT, INTERVAL; unsupported rules give only the first instance', () => {
  const ev = parseIcs(cal(
    ['UID:a', 'SUMMARY:Daily', 'DTSTART:20261120T120000Z', 'DURATION:PT1H', 'RRULE:FREQ=DAILY;UNTIL=20261122T120000Z'],
    ['UID:b', 'SUMMARY:Monthly', 'DTSTART;VALUE=DATE:20260131', 'RRULE:FREQ=MONTHLY'],
    ['UID:c', 'SUMMARY:Biweekly', 'DTSTART:20261102T120000Z', 'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3'],
    ['UID:d', 'SUMMARY:Yearly', 'DTSTART:20251124T120000Z', 'RRULE:FREQ=YEARLY'],
    ['UID:e', 'SUMMARY:Nth', 'DTSTART:20261103T120000Z', 'RRULE:FREQ=MONTHLY;BYDAY=1TU'],
  ));
  const t = (o, a, b) => occurrences(ev, new Date(Date.UTC(...a)), new Date(Date.UTC(...b))).filter(x => x.title === o).map(x => iso(x.start).slice(0, 10));
  assert.deepEqual(t('Daily', [2026, 10, 1], [2026, 11, 1]), ['2026-11-20', '2026-11-21', '2026-11-22']);
  assert.deepEqual(t('Monthly', [2026, 0, 1], [2026, 5, 1]).length, 3, '31 Jan, 31 Mar, 31 May: months without a 31st are skipped');
  assert.deepEqual(t('Biweekly', [2026, 10, 1], [2027, 0, 1]), ['2026-11-02', '2026-11-16', '2026-11-30']);
  assert.deepEqual(t('Yearly', [2026, 10, 1], [2026, 11, 1]), []);
  assert.deepEqual(t('Nth', [2026, 10, 1], [2027, 0, 1]), ['2026-11-03']);
});

test('a long-running series is expanded quickly', () => {
  const ev = parseIcs(cal(['UID:x', 'SUMMARY:Daily', 'DTSTART:19900101T120000Z', 'RRULE:FREQ=DAILY']));
  const t0 = Date.now(), got = occurrences(ev, new Date(2026, 10, 24), new Date(2026, 10, 26));
  assert.equal(got.length, 2); assert.ok(Date.now() - t0 < 200);
});

test('moved and cancelled instances replace the series instance', () => {
  const ev = parseIcs(cal(
    ['UID:s', 'SUMMARY:Weekly', 'DTSTART:20261102T150000Z', 'DTEND:20261102T160000Z', 'RRULE:FREQ=WEEKLY'],
    ['UID:s', 'SUMMARY:Weekly (moved)', 'RECURRENCE-ID:20261109T150000Z', 'DTSTART:20261110T150000Z', 'DTEND:20261110T160000Z'],
    ['UID:s', 'SUMMARY:Weekly', 'RECURRENCE-ID:20261116T150000Z', 'DTSTART:20261116T150000Z', 'STATUS:CANCELLED'],
  ));
  const got = occurrences(ev, new Date(Date.UTC(2026, 10, 1)), new Date(Date.UTC(2026, 10, 21)));
  assert.deepEqual(got.map(o => [o.title, iso(o.start).slice(0, 10)]), [['Weekly', '2026-11-02'], ['Weekly (moved)', '2026-11-10']]);
});

test('joinLink: the first meeting link of a known service, https only', () => {
  assert.equal(joinLink('see https://example.com/x then https://teams.microsoft.com/l/meetup-join/1 and https://zoom.us/j/2'), 'https://teams.microsoft.com/l/meetup-join/1');
  assert.equal(joinLink('Zoom: <https://us02web.zoom.us/j/123?pwd=a>.'), 'https://us02web.zoom.us/j/123?pwd=a');
  assert.equal(joinLink('https://meet.google.com/abc-defg-hij,'), 'https://meet.google.com/abc-defg-hij');
  assert.equal(joinLink('https://acme.webex.com/meet/x https://teams.live.com/meet/1'), 'https://acme.webex.com/meet/x');
  assert.equal(joinLink('https://example.com/only'), null);
  assert.equal(joinLink('http://teams.microsoft.com/x'), null);
  assert.equal(joinLink('https://evilzoom.us/j/1 https://zoom.us.example.com/j/1'), null);
  assert.equal(joinLink('https://user:pw@zoom.us/j/1'), null);
  assert.equal(joinLink(''), null); assert.equal(joinLink(null), null);
});

test('garbage in, no throw', () => {
  assert.equal(parseIcs('').length, 0);
  assert.equal(parseIcs(cal(['UID:q', 'SUMMARY:No start'], ['UID:r', 'DTSTART:notadate'])).length, 0);
  assert.equal(parseIcs(cal(['UID:t', 'DTSTART:20261124T090000'])).length, 1, 'no title is fine');
});

test('hostile feed: thousands of ancient COUNT series expand fast, and real events in the same feed still appear', () => {
  const bad = [];
  for (let i = 0; i < 1200; i++) bad.push([`UID:d${i}`, 'SUMMARY:Old daily', 'DTSTART:10000101T000000Z', 'RRULE:FREQ=DAILY;COUNT=999999']);
  for (let i = 0; i < 1200; i++) bad.push([`UID:w${i}`, 'SUMMARY:Old weekly', 'DTSTART:10000101T000000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU;COUNT=999999']);
  const ev = parseIcs(cal(['UID:ok', 'SUMMARY:Stand-up', 'DTSTART:20261124T150000Z', 'DTEND:20261124T151500Z'], ...bad));
  assert.equal(ev.length, 2401);
  const t0 = Date.now(), got = occurrences(ev, new Date(2026, 10, 24), new Date(2026, 10, 25)), ms = Date.now() - t0;
  assert.ok(ms < 500, `took ${ms} ms`);
  assert.ok(got.some(o => o.title === 'Stand-up'));
  // COUNT is still honoured when it is skipped over arithmetically: 999999 days from year 1000 end around year 3737, so today is in; 10 is not
  assert.equal(got.filter(o => o.title === 'Old daily').length, 1200);
  const few = parseIcs(cal(['UID:f', 'SUMMARY:Ten', 'DTSTART:20261101T120000Z', 'RRULE:FREQ=DAILY;COUNT=10'], ['UID:g', 'SUMMARY:Wk', 'DTSTART:20261104T120000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5']));
  assert.deepEqual(occurrences(few, new Date(Date.UTC(2026, 10, 10)), new Date(Date.UTC(2026, 10, 12))).map(o => o.title), ['Ten', 'Wk']);
  assert.deepEqual(occurrences(few, new Date(Date.UTC(2026, 10, 1)), new Date(Date.UTC(2026, 11, 1))).filter(o => o.title === 'Wk').map(o => iso(o.start).slice(0, 10)), ['2026-11-04', '2026-11-09', '2026-11-11', '2026-11-16', '2026-11-18']);
});

test('at most 5000 events are kept, and the result says it was cut', () => {
  const many = Array.from({ length: 5003 }, (_, i) => [`UID:m${i}`, 'SUMMARY:E', 'DTSTART:20261124T150000Z']);
  const ev = parseIcs(cal(...many));
  assert.equal(ev.length, 5000); assert.equal(ev.truncated, true);
  assert.equal(parseIcs(ICS).truncated, false);
});

test('hostile inputs never throw and give sane output', () => {
  const rows = [
    ['huge DURATION on a repeating TZID event', ['UID:a', 'SUMMARY:x', 'DTSTART;TZID=America/New_York:20261124T090000', 'DURATION:P99999999W', 'RRULE:FREQ=DAILY'], 0],
    ['invalid date', ['UID:b', 'DTSTART:20261399T990000'], 0],
    ['year 0', ['UID:c', 'DTSTART:00000101T000000Z', 'RRULE:FREQ=DAILY'], 0],
    ['year 0099', ['UID:c2', 'DTSTART;VALUE=DATE:00991124', 'RRULE:FREQ=YEARLY'], 0],
    ['unknown TZID', ['UID:d', 'SUMMARY:x', 'DTSTART;TZID=../../etc:20261124T090000'], 1],
    ['empty TZID', ['UID:d2', 'SUMMARY:x', 'DTSTART;TZID=:20261124T090000'], 1],
    ['INTERVAL=0', ['UID:e', 'SUMMARY:x', 'DTSTART:20261120T120000Z', 'RRULE:FREQ=DAILY;INTERVAL=0'], 1],
    ['INTERVAL negative', ['UID:f', 'SUMMARY:x', 'DTSTART:20261117T120000Z', 'RRULE:FREQ=WEEKLY;INTERVAL=-3'], 1],
    ['BYDAY garbage', ['UID:g', 'SUMMARY:x', 'DTSTART:20261123T120000Z', 'RRULE:FREQ=WEEKLY;BYDAY=XX,,;;'], 0],
    ['UNTIL before DTSTART', ['UID:h', 'SUMMARY:x', 'DTSTART:20261120T120000Z', 'RRULE:FREQ=DAILY;UNTIL=20200101T000000Z'], 0],
    ['DTEND before DTSTART', ['UID:i', 'SUMMARY:x', 'DTSTART:20261124T120000Z', 'DTEND:20201124T120000Z'], 1],
  ];
  const win = [new Date(2026, 10, 24), new Date(2026, 10, 25)];
  for (const [name, lines, n] of rows) {
    let ev, got;
    assert.doesNotThrow(() => { ev = parseIcs(cal(lines)); got = occurrences(ev, ...win); }, name);
    assert.equal(got.length, n, name);
    for (const o of got) assert.ok(Number.isFinite(+o.start) && Number.isFinite(+o.end), name);
  }
  const long = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:' + 'x'.repeat(1 << 20) + '\r\nDTSTART:20261124T120000Z';
  assert.doesNotThrow(() => { const ev = parseIcs(long); assert.equal(ev.length, 0, 'no END:VEVENT, no event'); });
  assert.doesNotThrow(() => occurrences(parseIcs(cal(['UID:j', 'DTSTART:20261124T120000Z', 'DESCRIPTION:' + 'https://zoom.us/'.repeat(60000)])), ...win));
  for (const junk of [null, undefined, 42, {}, '\u0000'.repeat(1000), 'BEGIN:VEVENT\nBEGIN:VEVENT\nEND:VCALENDAR']) assert.doesNotThrow(() => occurrences(parseIcs(junk), ...win));
  assert.doesNotThrow(() => occurrences([{ uid: 'z', title: 'x', start: new Date(NaN), end: new Date(NaN), allDay: false, where: '', text: '', rrule: { freq: 'DAILY', interval: 1, count: null, until: null, byday: null, wkst: 1, other: false }, exdates: [], zone: 'America/New_York', recurrenceId: null, cancelled: false, links: '' }], ...win));
});
