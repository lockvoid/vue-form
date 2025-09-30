import { mount } from "@vue/test-utils";
import * as v from "valibot";
import { describe, it, expect, vi } from "vitest";
import { defineComponent, nextTick } from "vue";
import { useForm } from "@/src/useForm";

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
  name: "FakeTextInput",
  props: {
    modelValue: { type: [String, Number, Boolean, Object, Array] as any, default: "" },
    onBlur: { type: Function },
  },
  emits: ["update:modelValue"],
  template: `
    <input
      data-testid="email"
      :value="modelValue"
      @input="$emit('update:modelValue', $event.target.value)"
      @blur="onBlur && onBlur($event)"
    />
  `,
});

const makeHost = (opts?: {
  mode?: "change" | "submit" | "blur";
  onSubmitImpl?: (vals: any, emit: (e: string, ...args: any[]) => void) => unknown | Promise<unknown>;
  renderErrors?: boolean;
  initialValues?: Record<string, any>;
}) =>
  defineComponent({
    name: "UseFormHost",
    components: { FakeTextInput },
    emits: ["success"],
    setup(_, { emit }) {
      const schema = v.pipe(v.object({ email: v.pipe(v.string(), v.email()) }));

      const form = useForm({
        schema,
        validationMode: opts?.mode ?? "change",
        ...(opts?.initialValues && { initialValues: opts.initialValues }),
        onSubmit: (vals: any) =>
          opts?.onSubmitImpl
            ? opts.onSubmitImpl(vals, emit)
            : (async () => {
              emit("success", vals);
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

describe("useForm — integration", () => {
  it("disables submit until email is valid, then enables", async () => {
    const Host = makeHost({ mode: "change" });
    const wrapper = mount(Host);

    const email = wrapper.get('[data-testid="email"]');
    const submit = wrapper.get('[data-testid="submit"]');

    expect(submit.attributes("disabled")).toBe("");

    await email.setValue("not-an-email");
    await nextTick();
    expect(submit.attributes("disabled")).toBe("");

    await email.setValue("john@example.com");
    await nextTick();
    expect(submit.attributes("disabled")).toBeUndefined();
  });

  it("submits values, shows loading during submit, and emits success", async () => {
    const gate = deferred<void>();
    const onSubmitSpy = vi.fn(async (vals: any, emit: any) => {
      expect(vals).toEqual({ email: "jane@acme.io" });
      await gate.promise;
      emit("success", vals);
    });

    const Host = makeHost({ onSubmitImpl: onSubmitSpy, mode: "change" });
    const wrapper = mount(Host);
    const email = wrapper.get('[data-testid="email"]');
    const submit = wrapper.get('[data-testid="submit"]');

    await email.setValue("jane@acme.io");
    await nextTick();

    await wrapper.get("form").trigger("submit.prevent");
    await flushAll(2);

    expect(submit.attributes("data-loading")).toBe("true");
    expect(onSubmitSpy).toHaveBeenCalledTimes(1);

    gate.resolve();
    await flushAll(5);

    const emitted = wrapper.emitted("success")!;
    expect(emitted?.[0]?.[0]).toEqual({ email: "jane@acme.io" });
    expect(submit.attributes("data-loading")).toBe("false");
  });

  it("does not call onSubmit when invalid", async () => {
    const onSubmitSpy = vi.fn();
    const Host = makeHost({ onSubmitImpl: onSubmitSpy, mode: "change" });
    const wrapper = mount(Host);

    await wrapper.get("form").trigger("submit.prevent");
    await flushAll(1);

    expect(onSubmitSpy).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="submit"]').attributes("disabled")).toBe("");
  });

  it('renders errors live in validationMode="change"', async () => {
    const Host = makeHost({ mode: "change", renderErrors: true });
    const wrapper = mount(Host);

    const email = wrapper.get('[data-testid="email"]');
    const errorText = () => wrapper.get('[data-testid="error-email"]').text() || "";

    await email.setValue("nope");
    await nextTick();
    expect(errorText()).not.toBe("");

    await email.setValue("valid@example.com");
    await nextTick();
    expect(errorText()).toBe("");
  });

  it('renders errors only after submit in validationMode="submit"', async () => {
    const onSubmitSpy = vi.fn();
    const Host = makeHost({ mode: "submit", renderErrors: true, onSubmitImpl: onSubmitSpy });
    const wrapper = mount(Host);

    const email = wrapper.get('[data-testid="email"]');
    const submit = wrapper.get('[data-testid="submit"]');
    const errorText = () => wrapper.get('[data-testid="error-email"]').text() || "";

    await email.setValue("bad");
    await nextTick();
    expect(errorText()).toBe("");
    expect(submit.attributes("disabled")).toBeUndefined();

    await wrapper.get("form").trigger("submit.prevent");
    await flushAll(2);
    expect(errorText()).not.toBe("");
    expect(onSubmitSpy).not.toHaveBeenCalled();

    await email.setValue("ok@site.io");
    await flushAll(2);
    expect(errorText()).toBe(""); // Error should clear immediately after submit mode switches to change mode

    await wrapper.get("form").trigger("submit.prevent");
    await flushAll(2);
    expect(errorText()).toBe("");
  });

  it('validates on change after first submit in validationMode="submit"', async () => {
    const onSubmitSpy = vi.fn();
    const Host = makeHost({ mode: "submit", renderErrors: true, onSubmitImpl: onSubmitSpy });
    const wrapper = mount(Host);

    const email = wrapper.get('[data-testid="email"]');
    const errorText = () => wrapper.get('[data-testid="error-email"]').text() || "";

    // Set invalid value and submit to trigger validation
    await email.setValue("invalid");
    await wrapper.get("form").trigger("submit.prevent");
    await flushAll(2);
    expect(errorText()).not.toBe("");
    expect(onSubmitSpy).not.toHaveBeenCalled();

    // Now changing value should validate immediately
    await email.setValue("valid@email.com");
    await flushAll(2);
    expect(errorText()).toBe("");

    // Change back to invalid should show error immediately
    await email.setValue("invalid-again");
    await flushAll(2);
    expect(errorText()).not.toBe("");
  });

  describe("blur validation mode", () => {
    it("does not show errors on change, only on blur", async () => {
      const Host = makeHost({ mode: "blur", renderErrors: true });
      const wrapper = mount(Host);

      const email = wrapper.get('[data-testid="email"]');
      const errorText = () => wrapper.get('[data-testid="error-email"]').text() || "";

      // Change to invalid value - should not show error
      await email.setValue("invalid");
      await nextTick();
      expect(errorText()).toBe("");

      // Blur should trigger validation and show error
      await email.trigger("blur");
      await flushAll(2);
      expect(errorText()).not.toBe("");
    });

    it("clears errors on blur when value becomes valid", async () => {
      const Host = makeHost({ mode: "blur", renderErrors: true });
      const wrapper = mount(Host);

      const email = wrapper.get('[data-testid="email"]');
      const errorText = () => wrapper.get('[data-testid="error-email"]').text() || "";

      // Set invalid and blur to show error
      await email.setValue("invalid");
      await email.trigger("blur");
      await flushAll(2);
      expect(errorText()).not.toBe("");

      // Set valid and blur to clear error
      await email.setValue("valid@email.com");
      await email.trigger("blur");
      await flushAll(2);
      expect(errorText()).toBe("");
    });

    it("continues blur validation after first blur", async () => {
      const Host = makeHost({ mode: "blur", renderErrors: true });
      const wrapper = mount(Host);

      const email = wrapper.get('[data-testid="email"]');
      const submit = wrapper.get('[data-testid="submit"]');
      const errorText = () => wrapper.get('[data-testid="error-email"]').text() || "";

      // First blur with valid value
      await email.setValue("valid@email.com");
      await email.trigger("blur");
      await flushAll(2);
      expect(errorText()).toBe("");
      expect(submit.attributes("disabled")).toBeUndefined();

      // Change to invalid without blur - should not show error yet
      await email.setValue("invalid");
      await nextTick();
      expect(errorText()).toBe("");
      expect(submit.attributes("disabled")).toBeFalsy(); // Still appears valid

      // Blur with invalid value - should show error
      await email.trigger("blur");
      await flushAll(2);
      expect(errorText()).not.toBe("");
      expect(submit.attributes("disabled")).toBe("");
    });

    it("allows form submission when valid after blur validation", async () => {
      const onSubmitSpy = vi.fn();
      const Host = makeHost({ mode: "blur", renderErrors: true, onSubmitImpl: onSubmitSpy });
      const wrapper = mount(Host);

      const email = wrapper.get('[data-testid="email"]');

      // Set valid value and blur
      await email.setValue("valid@email.com");
      await email.trigger("blur");
      await flushAll(2);

      // Submit should work
      await wrapper.get("form").trigger("submit.prevent");
      await flushAll(2);
      expect(onSubmitSpy).toHaveBeenCalledWith({ email: "valid@email.com" }, expect.any(Function));
    });
  });

  describe("initialValues", () => {
    it("displays initial values in input fields", async () => {
      const initialValues = { email: "initial@example.com" };
      const Host = makeHost({ mode: "change", initialValues });
      const wrapper = mount(Host);

      const email = wrapper.get('[data-testid="email"]');
      expect((email.element as HTMLInputElement).value).toBe("initial@example.com");
    });

    it("validates initial values in change mode", async () => {
      const initialValues = { email: "invalid-email" };
      const Host = makeHost({ mode: "change", renderErrors: true, initialValues });
      const wrapper = mount(Host);

      await nextTick();
      const submit = wrapper.get('[data-testid="submit"]');
      const errorText = () => wrapper.get('[data-testid="error-email"]').text() || "";

      expect(submit.attributes("disabled")).toBe("");
      expect(errorText()).not.toBe("");
    });

    it("does not validate initial values in submit mode", async () => {
      const initialValues = { email: "invalid-email" };
      const Host = makeHost({ mode: "submit", renderErrors: true, initialValues });
      const wrapper = mount(Host);

      await nextTick();
      const submit = wrapper.get('[data-testid="submit"]');
      const errorText = () => wrapper.get('[data-testid="error-email"]').text() || "";

      expect(submit.attributes("disabled")).toBeUndefined();
      expect(errorText()).toBe("");
    });

    it("does not validate initial values in blur mode", async () => {
      const initialValues = { email: "invalid-email" };
      const Host = makeHost({ mode: "blur", renderErrors: true, initialValues });
      const wrapper = mount(Host);

      await nextTick();
      const submit = wrapper.get('[data-testid="submit"]');
      const errorText = () => wrapper.get('[data-testid="error-email"]').text() || "";

      expect(submit.attributes("disabled")).toBeUndefined();
      expect(errorText()).toBe("");
    });

    it("allows changing from initial values", async () => {
      const initialValues = { email: "initial@example.com" };
      const Host = makeHost({ mode: "change", initialValues });
      const wrapper = mount(Host);

      const email = wrapper.get('[data-testid="email"]');
      expect((email.element as HTMLInputElement).value).toBe("initial@example.com");

      await email.setValue("changed@example.com");
      await nextTick();
      expect((email.element as HTMLInputElement).value).toBe("changed@example.com");
    });

    it("submits with valid initial values", async () => {
      const onSubmitSpy = vi.fn();
      const initialValues = { email: "valid@example.com" };
      const Host = makeHost({ 
        mode: "change", 
        initialValues, 
        onSubmitImpl: onSubmitSpy, 
      });
      const wrapper = mount(Host);

      const submit = wrapper.get('[data-testid="submit"]');
      expect(submit.attributes("disabled")).toBeUndefined();

      await wrapper.get("form").trigger("submit.prevent");
      await flushAll(2);

      expect(onSubmitSpy).toHaveBeenCalledWith({ email: "valid@example.com" }, expect.any(Function));
    });

    it("does not submit with invalid initial values in change mode", async () => {
      const onSubmitSpy = vi.fn();
      const initialValues = { email: "invalid-email" };
      const Host = makeHost({ 
        mode: "change", 
        initialValues, 
        onSubmitImpl: onSubmitSpy, 
      });
      const wrapper = mount(Host);

      await wrapper.get("form").trigger("submit.prevent");
      await flushAll(2);

      expect(onSubmitSpy).not.toHaveBeenCalled();
    });

    it("submits with invalid initial values in submit mode until validation is triggered", async () => {
      const onSubmitSpy = vi.fn();
      const initialValues = { email: "invalid-email" };
      const Host = makeHost({ 
        mode: "submit", 
        initialValues, 
        onSubmitImpl: onSubmitSpy, 
      });
      const wrapper = mount(Host);

      // First submit should trigger validation and fail
      await wrapper.get("form").trigger("submit.prevent");
      await flushAll(2);

      expect(onSubmitSpy).not.toHaveBeenCalled();
    });

    it("works with blur validation and initial values", async () => {
      const initialValues = { email: "invalid-email" };
      const Host = makeHost({ mode: "blur", renderErrors: true, initialValues });
      const wrapper = mount(Host);

      const email = wrapper.get('[data-testid="email"]');
      const errorText = () => wrapper.get('[data-testid="error-email"]').text() || "";

      // Initial state - no errors shown
      expect(errorText()).toBe("");

      // Blur should trigger validation
      await email.trigger("blur");
      await flushAll(2);
      expect(errorText()).not.toBe("");

      // Fix the value and blur again
      await email.setValue("valid@example.com");
      await email.trigger("blur");
      await flushAll(2);
      expect(errorText()).toBe("");
    });

    it("handles empty initial values", async () => {
      const initialValues = {};
      const Host = makeHost({ mode: "change", initialValues });
      const wrapper = mount(Host);

      const email = wrapper.get('[data-testid="email"]');
      expect((email.element as HTMLInputElement).value).toBe("");
    });

    it("preserves initial values after form reset", async () => {
      const initialValues = { email: "initial@example.com" };
      const Host = defineComponent({
        name: "ResetTestHost",
        components: { FakeTextInput },
        setup() {
          const schema = v.pipe(v.object({ email: v.pipe(v.string(), v.email()) }));
          const form = useForm({
            schema,
            validationMode: "change",
            initialValues,
            onSubmit: vi.fn(),
          });
          return { form };
        },
        template: `
          <form @submit.prevent="form.submit">
            <FakeTextInput v-bind="form.bind('email')" />
            <button type="button" data-testid="reset" @click="form.reset()">Reset</button>
            <div data-testid="form-email">{{ form.getValue('email') }}</div>
          </form>
        `,
      });

      const wrapper = mount(Host);
      const email = wrapper.get('[data-testid="email"]');
      const resetBtn = wrapper.get('[data-testid="reset"]');
      const formEmail = wrapper.get('[data-testid="form-email"]');

      // Change value
      await email.setValue("changed@example.com");
      await flushAll(2);
      expect(formEmail.text()).toBe("changed@example.com");

      // Reset should restore initial values
      await resetBtn.trigger("click");
      await flushAll(2);
      expect(formEmail.text()).toBe("initial@example.com");
    });

    it("works with native HTML input using v-bind", async () => {
      const initialValues = { email: "native@example.com" };
      const Host = defineComponent({
        name: "NativeInputHost",

        setup() {
          const schema = v.pipe(v.object({ email: v.pipe(v.string(), v.email()) }));
          
          const form = useForm({
            schema,
            validationMode: "change",
            initialValues,
            onSubmit: vi.fn(),
          });
          
          return { form };
        },

        template: `
          <form @submit.prevent="form.submit">
            <input v-bind="form.bind('email')" data-testid="native-email" type="text" />
            <div data-testid="form-value">{{ form.getValue('email') }}</div>
          </form>
        `,
      });

      const wrapper = mount(Host);
      const email = wrapper.get('[data-testid="native-email"]');
      const formValue = wrapper.get('[data-testid="form-value"]');

      // Check that native input displays initial value
      expect((email.element as HTMLInputElement).value).toBe("native@example.com");
      expect(formValue.text()).toBe("native@example.com");

      // Test that input changes work
      await email.setValue("changed@example.com");
      await flushAll(2);
      expect(formValue.text()).toBe("changed@example.com");
    });
  });
});
