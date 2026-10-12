/** @jest-environment node */
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const Root = require('../src/app/+html').default;
const { getWebContentSecurityPolicy } = require('../src/utils/web-security-policy');
const productionPolicy = require('../security/web-policy.json');

jest.mock('expo-router/html', () => ({ ScrollViewStyleReset: () => null }));

const directives = policy => Object.fromEntries(
  policy.split(';').map(entry => entry.trim().split(/\s+/)).map(([name, ...sources]) => [name, sources]),
);

describe('CSP da aplicação Web local', () => {
  it('preserva exatamente a política de produção, inclusive o hash de hidratação', () => {
    expect(getWebContentSecurityPolicy(false)).toBe(productionPolicy.contentSecurityPolicy);
    const prod = directives(getWebContentSecurityPolicy(false));
    expect(prod['connect-src']).toEqual(["'self'"]);
    expect(prod['script-src']).not.toContain("'unsafe-inline'");
    expect(prod['script-src']).not.toContain("'unsafe-eval'");
    expect(prod['script-src'].some(source => source.startsWith("'sha256-"))).toBe(true);
  });

  it('restringe conexões de desenvolvimento à origem atual e ao HMR de loopback', () => {
    expect(directives(getWebContentSecurityPolicy(true))['connect-src']).toEqual([
      "'self'", 'ws://localhost:*', 'ws://127.0.0.1:*',
    ]);
    expect(getWebContentSecurityPolicy(true)).not.toMatch(/https?:|googleapis|\*\./);
  });

  it('permite os scripts inline/eval do Metro sem hash que anule unsafe-inline', () => {
    const devScripts = directives(getWebContentSecurityPolicy(true))['script-src'];
    expect(devScripts).toEqual(["'self'", "'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'"]);
    expect(devScripts.some(source => source.startsWith("'sha256-") || source.startsWith("'nonce-"))).toBe(false);
  });

  it('mantém os bloqueios de mídia remota, frames, formulários e plugins em desenvolvimento', () => {
    const dev = directives(getWebContentSecurityPolicy(true));
    const prod = directives(getWebContentSecurityPolicy(false));
    for (const name of Object.keys(prod)) {
      if (name !== 'script-src' && name !== 'connect-src') expect(dev[name]).toEqual(prod[name]);
    }
    expect(dev['media-src']).toEqual(['blob:']);
    expect(dev['default-src']).toEqual(["'none'"]);
    expect(dev['form-action']).toEqual(["'none'"]);
    expect(dev['frame-src']).toEqual(["'none'"]);
    expect(dev['object-src']).toEqual(["'none'"]);
  });

  it.each([true, false])('inclui a CSP antes do conteúdo tanto com __DEV__=%s', development => {
    const previous = global.__DEV__;
    try {
      global.__DEV__ = development;
      const markup = renderToStaticMarkup(React.createElement(Root, null, React.createElement('div', { id: 'application-content' })));
      const expected = renderToStaticMarkup(React.createElement('meta', { httpEquiv: 'Content-Security-Policy', content: getWebContentSecurityPolicy(development) }));
      expect(markup).toContain(expected);
      expect(markup.indexOf('Content-Security-Policy')).toBeLessThan(markup.indexOf('application-content'));
    } finally {
      global.__DEV__ = previous;
    }
  });
});
