// @ts-check
import {describe, it, before, after} from 'node:test';
import {strict as assert} from 'node:assert';
import {installFakeDom} from '../lib/fake-dom.js';

describe('the short name of a frame, as the views label it', () => {
  /** @type {() => void} */
  let uninstall;
  /** @type {(name: string) => string} */
  let short;
  before(async () => {
    uninstall = installFakeDom();
    ({short} = await import('../../web/js/components/terrain-frame.js'));
  });
  after(() => uninstall());

  it('is the last two parts of a method, a class or a package', () => {
    assert.equal(short('com.acme.billing.Invoice.total'), 'Invoice.total');
    assert.equal(short('com.acme.billing.Invoice'), 'billing.Invoice');
    assert.equal(short('com.acme'), 'com.acme');
    assert.equal(short('byte[]'), 'byte[]');
  });

  it('leaves out the arguments of a native frame', () => {
    assert.equal(short('libfoo.read(int, void*)'), 'libfoo.read');
  });

  it('gives a lambda its class, not the digits of its address', () => {
    assert.equal(short('org.jgit.impl.Calculator$$Lambda$1313+0x0000023d038370f8.1005078208.test'),
                 'Calculator$$Lambda.test');
    assert.equal(short('app.Work$$Lambda.0x0000000800c0a000.run'), 'Work$$Lambda.run');
    assert.equal(short('app.Work$$Lambda$14/0x0000000800b3c840.apply'), 'Work$$Lambda.apply');
    assert.equal(short('app.Work$$Lambda$14.apply'), 'Work$$Lambda.apply');
  });

  it('leaves a class or a package alone, a lambda name with no method after it included', () => {
    assert.equal(short('app.Work$$Lambda'), 'app.Work$$Lambda');
    assert.equal(short('app.Work$Inner.run'), 'Work$Inner.run');
  });
});
