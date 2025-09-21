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

const triggerBlur = (binding: any, value?: unknown) => {
  if (typeof binding?.onBlur === 'function') {
    binding.onBlur(value !== undefined ? { target: { value } } : {});
    return;
  }
  throw new Error('onBlur handler not found in binding');
};

const makeSchema = () => v.pipe(v.object({ email: v.pipe(v.string(), v.email()) }));

const makeForm = (onSubmit: (values: any) => any, validationMode: 'change' | 'submit' | 'blur' = 'change', initialValues?: Record<string, any>) => {
  const scope = effectScope();
  const form = scope.run(() =>
    useForm({
      schema: makeSchema(),
      validationMode,
      onSubmit,
      ...(initialValues && { initialValues }),
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

  describe('blur validation mode', () => {
    it('appears valid by default but does not show errors until blur', async () => {
      const { scope, form } = makeForm(vi.fn(), 'blur');
      const email = form.bind('email');

      expect(unref(form.isInvalid)).toBe(false); // Appears valid until first blur
      expect(form.errors.email).toBeUndefined();

      setBoundFieldValue(email, 'not-an-email');
      await nextTick();
      expect(unref(form.isInvalid)).toBe(false); // Still appears valid
      expect(form.errors.email).toBeUndefined();

      scope.stop();
    });

    it('validates on blur and shows errors', async () => {
      const { scope, form } = makeForm(vi.fn(), 'blur');
      const email = form.bind('email');

      setBoundFieldValue(email, 'not-an-email');
      await nextTick();
      expect(form.errors.email).toBeUndefined();

      triggerBlur(email, 'not-an-email');
      await nextTick();
      expect(form.errors.email).toBeTruthy();
      expect(unref(form.isInvalid)).toBe(true);

      scope.stop();
    });

    it('clears errors when valid value is blurred', async () => {
      const { scope, form } = makeForm(vi.fn(), 'blur');
      const email = form.bind('email');

      // First blur with invalid value
      setBoundFieldValue(email, 'not-an-email');
      triggerBlur(email, 'not-an-email');
      await nextTick();
      expect(form.errors.email).toBeTruthy();

      // Second blur with valid value
      setBoundFieldValue(email, 'valid@email.com');
      triggerBlur(email, 'valid@email.com');
      await nextTick();
      expect(form.errors.email).toBeUndefined();
      expect(unref(form.isInvalid)).toBe(false);

      scope.stop();
    });

    it('continues to validate on blur after first blur', async () => {
      const { scope, form } = makeForm(vi.fn(), 'blur');
      const email = form.bind('email');

      // First blur with valid value
      setBoundFieldValue(email, 'valid@email.com');
      triggerBlur(email, 'valid@email.com');
      await nextTick();
      expect(form.errors.email).toBeUndefined();

      // Change to invalid without blur - should not show error
      setBoundFieldValue(email, 'invalid');
      await nextTick();
      expect(form.errors.email).toBeUndefined();

      // Blur with invalid value - should show error
      triggerBlur(email, 'invalid');
      await nextTick();
      expect(form.errors.email).toBeTruthy();

      scope.stop();
    });
  });

  describe('submit validation mode with change after submit', () => {
    it('does not validate on change initially', async () => {
      const { scope, form } = makeForm(vi.fn(), 'submit');
      const email = form.bind('email');

      setBoundFieldValue(email, 'not-an-email');
      await nextTick();
      expect(unref(form.isInvalid)).toBe(false); // Should appear valid until submit
      expect(form.errors.email).toBeUndefined();

      scope.stop();
    });

    it('validates on change after first submit attempt', async () => {
      const onSubmit = vi.fn();
      const { scope, form } = makeForm(onSubmit, 'submit');
      const email = form.bind('email');

      // Set invalid value and submit
      setBoundFieldValue(email, 'not-an-email');
      await form.submit();
      await nextTick();

      expect(onSubmit).not.toHaveBeenCalled();
      expect(form.errors.email).toBeTruthy();

      // Now changing value should validate immediately
      setBoundFieldValue(email, 'valid@email.com');
      await nextTick();
      expect(form.errors.email).toBeUndefined();
      expect(unref(form.isInvalid)).toBe(false);

      // Change back to invalid should show error immediately
      setBoundFieldValue(email, 'invalid-again');
      await nextTick();
      expect(form.errors.email).toBeTruthy();
      expect(unref(form.isInvalid)).toBe(true);

      scope.stop();
    });

    it('successful submit enables change validation for future changes', async () => {
      const onSubmit = vi.fn();
      const { scope, form } = makeForm(onSubmit, 'submit');
      const email = form.bind('email');

      // Set valid value and submit successfully
      setBoundFieldValue(email, 'valid@email.com');
      await form.submit();
      await nextTick();

      expect(onSubmit).toHaveBeenCalledWith({ email: 'valid@email.com' });

      // Now changing to invalid should validate immediately
      setBoundFieldValue(email, 'invalid');
      await nextTick();
      expect(form.errors.email).toBeTruthy();
      expect(unref(form.isInvalid)).toBe(true);

      scope.stop();
    });
  });

  describe('initialValues', () => {
    it('uses empty object as default when no initialValues provided', () => {
      const { scope, form } = makeForm(vi.fn());
      
      expect(form.values).toEqual({});
      expect(form.getValue('email')).toBeUndefined();
      
      scope.stop();
    });

    it('sets initial values correctly', () => {
      const initialValues = { email: 'test@example.com' };
      const { scope, form } = makeForm(vi.fn(), 'change', initialValues);
      
      expect(form.values).toEqual(initialValues);
      expect(form.getValue('email')).toBe('test@example.com');
      
      scope.stop();
    });

    it('validates initial values in change mode', async () => {
      const initialValues = { email: 'invalid-email' };
      const { scope, form } = makeForm(vi.fn(), 'change', initialValues);
      
      await nextTick();
      expect(unref(form.isInvalid)).toBe(true);
      expect(form.errors.email).toBeTruthy();
      
      scope.stop();
    });

    it('does not validate initial values in submit mode', async () => {
      const initialValues = { email: 'invalid-email' };
      const { scope, form } = makeForm(vi.fn(), 'submit', initialValues);
      
      await nextTick();
      expect(unref(form.isInvalid)).toBe(false); // Appears valid until submit
      expect(form.errors.email).toBeUndefined();
      
      scope.stop();
    });

    it('does not validate initial values in blur mode', async () => {
      const initialValues = { email: 'invalid-email' };
      const { scope, form } = makeForm(vi.fn(), 'blur', initialValues);
      
      await nextTick();
      expect(unref(form.isInvalid)).toBe(false); // Appears valid until blur
      expect(form.errors.email).toBeUndefined();
      
      scope.stop();
    });

    it('allows changing values from initial values', async () => {
      const initialValues = { email: 'initial@example.com' };
      const { scope, form } = makeForm(vi.fn(), 'change', initialValues);
      const email = form.bind('email');
      
      expect(form.getValue('email')).toBe('initial@example.com');
      
      setBoundFieldValue(email, 'new@example.com');
      await nextTick();
      
      expect(form.getValue('email')).toBe('new@example.com');
      expect(form.values.email).toBe('new@example.com');
      
      scope.stop();
    });

    it('submits with initial values when valid', async () => {
      const onSubmit = vi.fn();
      const initialValues = { email: 'valid@example.com' };
      const { scope, form } = makeForm(onSubmit, 'change', initialValues);
      
      await form.submit();
      await nextTick();
      
      expect(onSubmit).toHaveBeenCalledWith({ email: 'valid@example.com' });
      
      scope.stop();
    });

    it('does not submit with invalid initial values', async () => {
      const onSubmit = vi.fn();
      const initialValues = { email: 'invalid-email' };
      const { scope, form } = makeForm(onSubmit, 'change', initialValues);
      
      await form.submit();
      await nextTick();
      
      expect(onSubmit).not.toHaveBeenCalled();
      expect(form.errors.email).toBeTruthy();
      
      scope.stop();
    });

    it('resets to initial values when reset is called without arguments', async () => {
      const initialValues = { email: 'initial@example.com' };
      const { scope, form } = makeForm(vi.fn(), 'change', initialValues);
      const email = form.bind('email');
      
      // Change value
      setBoundFieldValue(email, 'changed@example.com');
      await nextTick();
      expect(form.getValue('email')).toBe('changed@example.com');
      
      // Reset
      form.reset();
      await nextTick();
      expect(form.getValue('email')).toBe('initial@example.com');
      expect(form.values).toEqual(initialValues);
      
      scope.stop();
    });

    it('resets to new values when reset is called with arguments', async () => {
      const initialValues = { email: 'initial@example.com' };
      const newValues = { email: 'new@example.com' };
      const { scope, form } = makeForm(vi.fn(), 'change', initialValues);
      
      form.reset(newValues);
      await nextTick();
      
      expect(form.getValue('email')).toBe('new@example.com');
      expect(form.values).toEqual(newValues);
      
      scope.stop();
    });

    it('handles multiple initial values', () => {
      const makeMultiFieldSchema = () => v.pipe(v.object({ 
        email: v.pipe(v.string(), v.email()),
        name: v.pipe(v.string(), v.minLength(1))
      }));
      
      const initialValues = { email: 'test@example.com', name: 'John Doe' };
      const scope = effectScope();
      const form = scope.run(() =>
        useForm({
          schema: makeMultiFieldSchema(),
          validationMode: 'change',
          onSubmit: vi.fn(),
          initialValues,
        })
      )!;
      
      expect(form.values).toEqual(initialValues);
      expect(form.getValue('email')).toBe('test@example.com');
      expect(form.getValue('name')).toBe('John Doe');
      
      scope.stop();
    });

    it('binding reflects initial values', () => {
      const initialValues = { email: 'test@example.com' };
      const { scope, form } = makeForm(vi.fn(), 'change', initialValues);
      const email = form.bind('email');
      
      expect(email.modelValue).toBe('test@example.com');
      
      scope.stop();
    });
  });
});
