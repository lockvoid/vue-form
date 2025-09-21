import { describe, it, expect, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import * as v from 'valibot';
import { useForm } from '@/src/useForm';

const deferred = <T = void>() => {
  let resolve!: (v: T) => void;
  let reject!: (r?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flushAll = async (cycles = 3) => {
  for (let i = 0; i < cycles; i++) {
    await Promise.resolve();
    await nextTick();
  }
};

const FakeTextInput = defineComponent({
  name: 'FakeTextInput',
  props: {
    modelValue: { type: [String, Number, Boolean, Object, Array] as any, default: '' },
  },
  emits: ['update:modelValue'],
  template: `
    <input
      data-testid="email"
      :value="modelValue"
      @input="$emit('update:modelValue', $event.target.value)"
    />
  `,
});

const makeHost = (opts?: {
  mode?: 'change' | 'submit';
  onSubmitImpl?: (vals: any, emit: (e: string, ...args: any[]) => void) => unknown | Promise<unknown>;
  renderErrors?: boolean;
}) =>
  defineComponent({
    name: 'UseFormHost',
    components: { FakeTextInput },
    emits: ['success'],
    setup(_, { emit }) {
      const schema = v.pipe(v.object({ email: v.pipe(v.string(), v.email()) }));

      const form = useForm({
        schema,
        validationMode: opts?.mode ?? 'change',
        onSubmit: (vals: any) =>
          opts?.onSubmitImpl
            ? opts.onSubmitImpl(vals, emit)
            : (async () => {
              emit('success', vals);
            })(),
      });

      return { form, renderErrors: opts?.renderErrors ?? false };
    },
    template: `
      <form @submit.prevent="form.submit">
        <FakeTextInput v-bind="form.bind('email')" />
        <button
          type="submit"
          data-testid="submit"
          :disabled="form.isInvalid.value"
          :data-loading="form.isSubmitting.value"
        >
          Continue
        </button>

        <div v-if="renderErrors" data-testid="errors">
          <p data-testid="error-email">{{ form.errors.email }}</p>
        </div>
      </form>
    `,
  });

describe('useForm — integration', () => {
  it('disables submit until email is valid, then enables', async () => {
    const Host = makeHost({ mode: 'change' });
    const wrapper = mount(Host);

    const email = wrapper.get('[data-testid="email"]');
    const submit = wrapper.get('[data-testid="submit"]');

    expect(submit.attributes('disabled')).toBe('');

    await email.setValue('not-an-email');
    await nextTick();
    expect(submit.attributes('disabled')).toBe('');

    await email.setValue('john@example.com');
    await nextTick();
    expect(submit.attributes('disabled')).toBeUndefined();
  });

  it('submits values, shows loading during submit, and emits success', async () => {
    const gate = deferred<void>();
    const onSubmitSpy = vi.fn(async (vals: any, emit: any) => {
      expect(vals).toEqual({ email: 'jane@acme.io' });
      await gate.promise;
      emit('success', vals);
    });

    const Host = makeHost({ onSubmitImpl: onSubmitSpy, mode: 'change' });
    const wrapper = mount(Host);
    const email = wrapper.get('[data-testid="email"]');
    const submit = wrapper.get('[data-testid="submit"]');

    await email.setValue('jane@acme.io');
    await nextTick();

    await wrapper.get('form').trigger('submit.prevent');
    await flushAll(2);

    expect(submit.attributes('data-loading')).toBe('true');
    expect(onSubmitSpy).toHaveBeenCalledTimes(1);

    gate.resolve();
    await flushAll(5);

    const emitted = wrapper.emitted('success')!;
    expect(emitted?.[0]?.[0]).toEqual({ email: 'jane@acme.io' });
    expect(submit.attributes('data-loading')).toBe('false');
  });

  it('does not call onSubmit when invalid', async () => {
    const onSubmitSpy = vi.fn();
    const Host = makeHost({ onSubmitImpl: onSubmitSpy, mode: 'change' });
    const wrapper = mount(Host);

    await wrapper.get('form').trigger('submit.prevent');
    await flushAll(1);

    expect(onSubmitSpy).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="submit"]').attributes('disabled')).toBe('');
  });

  it('renders errors live in validationMode="change"', async () => {
    const Host = makeHost({ mode: 'change', renderErrors: true });
    const wrapper = mount(Host);

    const email = wrapper.get('[data-testid="email"]');
    const errorText = () => wrapper.get('[data-testid="error-email"]').text() || '';

    await email.setValue('nope');
    await nextTick();
    expect(errorText()).not.toBe('');

    await email.setValue('valid@example.com');
    await nextTick();
    expect(errorText()).toBe('');
  });

  it('renders errors only after submit in validationMode="submit"', async () => {
    const onSubmitSpy = vi.fn();
    const Host = makeHost({ mode: 'submit', renderErrors: true, onSubmitImpl: onSubmitSpy });
    const wrapper = mount(Host);

    const email = wrapper.get('[data-testid="email"]');
    const submit = wrapper.get('[data-testid="submit"]');
    const errorText = () => wrapper.get('[data-testid="error-email"]').text() || '';

    await email.setValue('bad');
    await nextTick();
    expect(errorText()).toBe('');
    expect(submit.attributes('disabled')).toBeUndefined();

    await wrapper.get('form').trigger('submit.prevent');
    await flushAll(2);
    expect(errorText()).not.toBe('');
    expect(onSubmitSpy).not.toHaveBeenCalled();

    await email.setValue('ok@site.io');
    await flushAll(2);
    expect(errorText()).not.toBe('');

    await wrapper.get('form').trigger('submit.prevent');
    await flushAll(2);
    expect(errorText()).toBe('');
  });
});
