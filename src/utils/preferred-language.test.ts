// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import Defuddle from 'defuddle';
import { createMarkdownContent } from 'defuddle/full';
import { getPreferredLanguage } from './preferred-language';

afterEach(() => vi.unstubAllGlobals());

describe('preferred extraction language', () => {
	test('browser language takes precedence over the source document', () => {
		vi.stubGlobal('navigator', { language: 'ja-JP' });
		const doc = new DOMParser().parseFromString('<html lang="en"></html>', 'text/html');
		expect(getPreferredLanguage(doc)).toBe('ja-JP');
	});

	test.each([undefined, { language: '' }])('falls back to the source document without a browser language (%j)', nav => {
		vi.stubGlobal('navigator', nav);
		const doc = new DOMParser().parseFromString('<html lang="ja"></html>', 'text/html');
		expect(getPreferredLanguage(doc)).toBe('ja');
		expect(getPreferredLanguage()).toBeUndefined();
		expect(getPreferredLanguage(new DOMParser().parseFromString('<html></html>', 'text/html'))).toBeUndefined();
	});

	// Synthetic network responses test the installed Defuddle implementation;
	// these are not evidence of a successful live YouTube clip.
	test.each([
		{ tracks: ['en-US', 'ja-JP'], preferred: undefined, expected: 'English transcript example.' },
		{ tracks: ['en-US', 'ja-JP'], preferred: 'ja-JP', expected: '日本語字幕のテストです。' },
		{ tracks: ['en-US', 'ja-JP'], preferred: 'ja', expected: '日本語字幕のテストです。' },
		{ tracks: ['en-US'], preferred: 'ja-JP', expected: 'English transcript example.' },
		{ tracks: ['ja-JP'], preferred: 'ja-JP', expected: '日本語字幕のテストです。' },
	])('extracts the expected transcript: $tracks / $preferred', async ({ tracks, preferred, expected }) => {
		vi.stubGlobal('navigator', { language: preferred });
		const url = 'https://www.youtube.com/watch?v=fixture0001';
		const doc = new DOMParser().parseFromString('<html><head><title>Fixture</title></head><body></body></html>', 'text/html');
		const fetchFixture = vi.fn(async (input: RequestInfo | URL) => {
			const request = String(input);
			if (request.includes('/player?')) return new Response(JSON.stringify({
				videoDetails: { videoId: 'fixture0001' },
				captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks.map(languageCode => ({
					languageCode, baseUrl: `https://www.youtube.com/api/timedtext?lang=${languageCode}`,
				})) } },
			}));
			if (request.includes('/timedtext?')) return new Response(`<transcript><text start="0" dur="3">${request.includes('lang=ja') ? '日本語字幕のテストです。' : 'English transcript example.'}</text></transcript>`);
			if (request.includes('/next?')) return new Response('{}');
			throw new Error(`Unexpected fixture request: ${request}`);
		});
		const result = await new Defuddle(doc, { url, language: getPreferredLanguage(doc), fetch: fetchFixture }).parseAsync();
		expect(JSON.stringify(result.variables)).toContain(expected);
		expect(fetchFixture.mock.calls.some(([request]) => String(request).includes('/timedtext?'))).toBe(true);
	});

	test('preserves article metadata, content, and Markdown', () => {
		vi.stubGlobal('navigator', { language: 'ja-JP' });
		const html = '<html lang="en"><head><title>Example article</title><meta name="author" content="Example Author"></head><body><article><h1>Example article</h1><p>' + 'This is an article with useful details and a <strong>bold phrase</strong>. '.repeat(20) + '</p></article></body></html>';
		const parse = (language?: string) => new Defuddle(new DOMParser().parseFromString(html, 'text/html'), { url: 'https://example.com/article', language }).parse();
		const before = parse();
		const after = parse(getPreferredLanguage());
		expect(after.title).toBe('Example article');
		expect(after.author).toBe('Example Author');
		expect(after.content).toBe(before.content);
		expect(createMarkdownContent(after.content, 'https://example.com/article')).toBe(createMarkdownContent(before.content, 'https://example.com/article'));
	});
});
