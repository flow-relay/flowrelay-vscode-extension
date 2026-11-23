import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMcpProvider, hasMcpDefinitions, mcpUrl, type McpHostLike } from '../src/mcp-provider';
import { chatApiOf, lmApiOf } from '../src/vscode-compat';

class FakeDefinition {
  constructor(
    public label: string,
    public uri: unknown,
    public headers: Record<string, string> = {},
    public version?: string,
  ) {}
}

const host: McpHostLike = { Uri: { parse: (v) => ({ href: v }) }, McpHttpServerDefinition: FakeDefinition };

test('mcpUrl trims trailing slashes', () => {
  assert.equal(mcpUrl('https://www.flowrelay.it/'), 'https://www.flowrelay.it/mcp');
});

test('provides one definition without a secret in it', async () => {
  const provider = createMcpProvider(host, { baseUrl: () => 'https://www.flowrelay.it', version: '1.10.0', getKey: async () => 'fr_k', askForKey: async () => undefined });
  const [def] = (await provider.provideMcpServerDefinitions({} as never)) as unknown as FakeDefinition[];
  assert.equal(def.label, 'Flow Relay');
  assert.deepEqual(def.uri, { href: 'https://www.flowrelay.it/mcp' });
  assert.deepEqual(def.headers, {});
  assert.equal(def.version, '1.10.0');
});

test('resolve adds the bearer from the stored key', async () => {
  const provider = createMcpProvider(host, { baseUrl: () => 'https://x.test', version: '1', getKey: async () => 'fr_secret', askForKey: async () => undefined });
  const def = new FakeDefinition('Flow Relay', {});
  const resolved = (await provider.resolveMcpServerDefinition!(def, {} as never)) as unknown as FakeDefinition;
  assert.equal(resolved.headers.Authorization, 'Bearer fr_secret');
});

test('resolve asks for a key when none is stored and declines when none is given', async () => {
  let asked = 0;
  const provider = createMcpProvider(host, { baseUrl: () => 'https://x.test', version: '1', getKey: async () => undefined, askForKey: async () => (asked++ === 0 ? 'fr_new' : undefined) });
  const first = (await provider.resolveMcpServerDefinition!(new FakeDefinition('x', {}), {} as never)) as unknown as FakeDefinition;
  assert.equal(first.headers.Authorization, 'Bearer fr_new');
  assert.equal(await provider.resolveMcpServerDefinition!(new FakeDefinition('x', {}), {} as never), undefined);
});

test('runtime detection tolerates hosts without the APIs', () => {
  assert.equal(hasMcpDefinitions({ Uri: { parse: () => null } }), false);
  assert.equal(chatApiOf({}), null);
  assert.equal(chatApiOf({ chat: {} }), null);
  assert.equal(lmApiOf({ lm: {} }), null);
  assert.ok(chatApiOf({ chat: { createChatParticipant: () => ({}) } }));
  assert.ok(lmApiOf({ lm: { registerMcpServerDefinitionProvider: () => ({}) } }));
});
