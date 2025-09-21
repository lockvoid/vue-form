import { describe, it, expect, vi } from 'vitest';
import { effectScope, nextTick, unref, isRef } from 'vue';
import * as v from 'valibot';
import { useForm } from '@/src/useForm';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (r?: unknown) => void;
};

const deferred = <T = void>(): Deferred<T> => {
  let resolve!: (v: T) => void;
  let reject!: (r?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const setBoundFieldValue = (binding: any, value: unknown) => {
  if (typeof binding?.['onUpdate:modelValue'] === 'function') {
    binding['onUpdate:modelValue'](value);
    return;
  }
  if (typeof binding?.onInput === 'function') {
    binding.onInput({ target: { value } });
    return;
  }
  if (typeof binding?.onChange === 'function') {
    binding.onChange(value);
    return;
  }
  throw new Error('Unknown binding shape from form.bind(...)');
};

const makeSchema = () => v.pipe(v.object({ email: v.pipe(v.string(), v.email()) }));

const makeForm = (onSubmit: (values: any) => any) => {
  const scope = effectScope();
  const form = scope.run(() =>
    useForm({
      schema: makeSchema(),
      validationMode: 'change',
      onSubmit,
    })
  )!;
  return { scope, form };
};

describe('useForm — unit', () => {
  it('exposes the expected public API', () => {
    const noop = vi.fn();
    const { scope, form } = makeForm(noop);

    expect(typeof form.bind).toBe('function');
    expect(typeof form.submit).toBe('function');
    expect(isRef(form.isInvalid)).toBe(true);
    expect(isRef(form.isSubmitting)).toBe(true);

    scope.stop();
  });

  it('is invalid by default', async () => {
    const { scope, form } = makeForm(vi.fn());
    expect(unref(form.isInvalid)).toBe(true);
    scope.stop();
  });

  it('validates on change', async () => {
    const { scope, form } = makeForm(vi.fn());
    const email = form.bind('email');

    setBoundFieldValue(email, 'not-an-email');
    await nextTick();
    expect(unref(form.isInvalid)).toBe(true);

    setBoundFieldValue(email, 'john@example.com');
    await nextTick();
    expect(unref(form.isInvalid)).toBe(false);

    scope.stop();
  });

  it('does not call onSubmit when invalid', async () => {
    const onSubmit = vi.fn();
    const { scope, form } = makeForm(onSubmit);

    await form.submit();
    await nextTick();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(unref(form.isSubmitting)).toBe(false);

    scope.stop();
  });

  it('calls onSubmit with values when valid and toggles isSubmitting', async () => {
    let formRef: any;

    const onSubmit = vi.fn(async (vals) => {
      expect(unref(formRef.isSubmitting)).toBe(true);
      expect(vals).toEqual({ email: 'jane@acme.io' });
    });

    const { scope, form } = makeForm(onSubmit);
    formRef = form;

    setBoundFieldValue(form.bind('email'), 'jane@acme.io');
    await nextTick();
    expect(unref(form.isInvalid)).toBe(false);

    const submitPromise = form.submit();
    await submitPromise;

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(unref(form.isSubmitting)).toBe(false);

    scope.stop();
  });

  it('isSubmitting stays true until onSubmit resolves', async () => {
    const gate = deferred<void>();
    const onSubmit = vi.fn().mockImplementation(() => gate.promise);
    const { scope, form } = makeForm(onSubmit);

    setBoundFieldValue(form.bind('email'), 'hold@please.com');
    await nextTick();

    const p = form.submit();
    await nextTick();
    expect(unref(form.isSubmitting)).toBe(true);

    gate.resolve();
    await p;
    expect(unref(form.isSubmitting)).toBe(false);

    scope.stop();
  });

  it('submit propagates errors from onSubmit and resets isSubmitting', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'));
    const { scope, form } = makeForm(onSubmit);

    setBoundFieldValue(form.bind('email'), 'err@case.io');
    await nextTick();

    await expect(form.submit()).rejects.toThrow('boom');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(unref(form.isSubmitting)).toBe(false);

    scope.stop();
  });

  it('bind returns a usable binding shape', async () => {
    const { scope, form } = makeForm(vi.fn());
    const binding = form.bind('email');

    expect(binding).toHaveProperty('modelValue');
    expect(
      typeof binding['onUpdate:modelValue'] === 'function' ||
      typeof binding.onInput === 'function' ||
      typeof binding.onChange === 'function'
    ).toBe(true);

    setBoundFieldValue(binding, 'foo@bar.com');
    await nextTick();
    expect(unref(form.isInvalid)).toBe(false);

    scope.stop();
  });

  it('bind returns a stable object per field', () => {
    const { scope, form } = makeForm(vi.fn());
    const a = form.bind('email');
    const b = form.bind('email');
    expect(a).toBe(b);
    scope.stop();
  });
});
