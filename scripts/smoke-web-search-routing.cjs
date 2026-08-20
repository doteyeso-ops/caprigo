const {
  parseDdgHtmlResults,
  parseGeminiSearchResponse,
  parseBraveSearchResponse,
  parseBraveHtmlResults,
} = require('../packages/agent/dist/skills/web');
const {
  looksLikeKnowledgeRefusal,
  userLikelyNeedsWeb,
} = require('../packages/agent/dist/model-profile');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
}

const sample = `
<html><body>
<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.meetup.com%2Fnashville-ai%2F">Nashville AI Meetup</a>
<a class="result__a" href="https://example.com/events">Local AI events near Nashville</a>
</body></html>
`;
const hits = parseDdgHtmlResults(sample, 5);
assert(hits.length >= 1, 'parse hits');
assert(hits.some(h => /meetup\.com/i.test(h.url)), 'unwrap uddg');
assert(hits.some(h => /Nashville/i.test(h.text)), 'title text');

assert(
  looksLikeKnowledgeRefusal("I don't have direct information about AI meetups near Nashville."),
  'refusal detect'
);
assert(!looksLikeKnowledgeRefusal('Here are three meetups I found via search.'), 'non-refusal');
assert(userLikelyNeedsWeb('find local AI meetups near Nashville'), 'needs web');
assert(!userLikelyNeedsWeb('search the codebase for TODO'), 'local code not web');

const gem = parseGeminiSearchResponse(
  {
    candidates: [
      {
        content: { parts: [{ text: 'Nashville AI Meetup meets monthly downtown.' }] },
        groundingMetadata: {
          webSearchQueries: ['AI meetups Nashville'],
          groundingChunks: [
            { web: { uri: 'https://www.meetup.com/nashville-ai/', title: 'Nashville AI' } },
          ],
        },
      },
    ],
  },
  'AI meetups Nashville',
  'gemini-2.5-flash'
);
assert(gem.success === true, 'gemini parse ok');
assert(/Google AI answer/i.test(gem.summary), 'gemini summary');
assert(gem.related[0].url.includes('meetup.com'), 'gemini source');

const brave = parseBraveSearchResponse(
  {
    web: {
      results: [
        {
          title: 'Nashville AI Meetup',
          url: 'https://www.meetup.com/nashville-ai/',
          description: 'Monthly AI community meetup',
        },
      ],
    },
  },
  'AI meetups Nashville'
);
assert(brave.success === true, 'brave parse ok');
assert(brave.source === 'brave', 'brave source');
assert(brave.related[0].url.includes('meetup.com'), 'brave url');

const braveHtml = `
<div class="snippet" data-type="web"><div class="result-content">
<a href="https://nashville.aitinkerers.org/" class="svelte-x l1"><div></div></a>
<div class="title search-snippet-title">AI Events in Nashville</div>
</div></div>
<div class="snippet" data-type="web"><div class="result-content">
<a href="https://www.meetup.com/nashville-ai-engineering/" class="foo l1"></a>
<div class="title search-snippet-title">Artificial Intelligencers | Meetup</div>
</div></div>
`;
const bh = parseBraveHtmlResults(braveHtml, 5);
assert(bh.length >= 2, 'brave html count');
assert(bh[0].url.includes('aitinkerers'), 'brave html url');
assert(/Nashville/i.test(bh[0].text), 'brave html title');

console.log('OK web-search-routing');
