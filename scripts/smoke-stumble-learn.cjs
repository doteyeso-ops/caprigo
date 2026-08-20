const {
  noteStumbleFailure,
  createStumbleState,
  suggestedFixForFailure,
  buildStumbleRetryUserMessage,
} = require('../packages/agent/dist/stumble');
const { recallLessons, ensureCoreLessons } = require('../packages/agent/dist/brain');

ensureCoreLessons();
const st = createStumbleState();
const n = noteStumbleFailure(
  st,
  'write_file',
  "ENOENT: no such file or directory, open 'C:\\tmp\\x.html'",
  { modelId: 'test', autoLesson: true }
);
console.log('noted', n);
console.log('fix', suggestedFixForFailure('write_file', 'ENOENT: no such file'));
console.log(
  'userMsg',
  buildStumbleRetryUserMessage({
    tool: 'write_file',
    error: 'ENOENT',
    count: 1,
    escalate: false,
  })
);
const lessons = recallLessons({ signature: n.signature, includeSticky: true, limit: 3 });
console.log(
  'recalled',
  lessons.map(l => `${l.signature} :: ${l.fix.slice(0, 90)}`)
);
const sticky = recallLessons({ query: 'write html file enoent', includeSticky: true, limit: 8 });
console.log(
  'query',
  sticky.map(l => l.signature)
);
if (!n.lessonId) {
  console.error('FAIL no lesson on first failure');
  process.exit(1);
}
if (!lessons.length && !sticky.some(l => /enoent|write_file/i.test(l.signature + l.fix))) {
  console.error('FAIL lesson not recallable');
  process.exit(1);
}
console.log('OK stumble-learn');
