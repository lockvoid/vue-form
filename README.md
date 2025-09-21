# @lockvoid/vue-form

Tiny, fast, **Vue 3** form composable with **stable bindings** and **Valibot** validation.

- Zero components, just a composable
- Stable `bind()` objects (no churn)
- Easy to unit/integration test
- Works with any input (native or custom) via a simple binding shape
- Two validation modes: `"change"` and `"submit"`

---

## Installation

```bash
# with pnpm
pnpm add @lockvoid/vue-form valibot

# or with npm
npm i @lockvoid/vue-form valibot

# or with yarn
yarn add @lockvoid/vue-form valibot
```

> `valibot` is a peer dependency.

---

## Quick start

```vue
<script setup lang="ts">
import { useForm } from '@lockvoid/vue-form'
import * as v from 'valibot'

const schema = v.pipe(
  v.object({
    email: v.pipe(v.string(), v.email()),
  })
)

const form = useForm({
  schema,

  validationMode: 'change', // 'submit' by default

  async onSubmit({ email }) {
    await api.createOtp({ email })
  },
})
</script>

<template>
  <form @submit.prevent="form.submit">
    <!-- Works with any input: provide modelValue + one of the handlers -->
    <input
      v-bind="form.bind('email')"
      placeholder="Email"
      autocomplete="email"
    />

    <!-- NOTE: nested refs require `.value` in templates -->
    <button type="submit" :disabled="form.isInvalid.value">
      Submit
    </button>

    <!-- Example errors rendering (optional) -->
    <p v-if="form.errors.email">{{ form.errors.email }}</p>
  </form>
</template>
```

---

## Concepts

### Stable bindings

`form.bind('field')` returns the **same object instance** across renders:

```ts
const binding = form.bind('email')
/**
 * binding has:
 * - modelValue (getter)
 * - onUpdate:modelValue(v)
 * - onInput(e)
 * - onChange(e)
 * - name
 */
```

This avoids unnecessary prop/listener diffs in child inputs.

You can use it with:
- native `<input>` (uses `onInput`)
- custom components using `v-model` (uses `onUpdate:modelValue`)
- or `onChange`-style components

### Validation modes

- `"change"`: validates on every change and updates `errors` live.
- `"submit"` (default): UI stays **neutral** until the first submit.
  After the first submit, errors are computed. (By default, errors persist until the next submit.)

---

## API

### `useForm(options)`

```ts
type ValidationMode = 'change' | 'submit'

type UseFormOptions = {
  schema: any; // Valibot schema
  initialValues?: Record<string, any>;
  validationMode?: ValidationMode; // default: 'submit'
  onSubmit: (values: Record<string, any>) => unknown | Promise<unknown>;
}
```

**Returns:**

```ts
{
  // Actions
  bind(name: string): Binding
  submit(): Promise<void>

  // State (refs)
  isInvalid: Ref<boolean>
  isSubmitting: Ref<boolean>

  // State (reactive)
  values: Record<string, any>
  errors: Record<string, string | null>
}
```

**Binding shape:**

```ts
type Binding = {
  readonly modelValue: any
  readonly name: string
  readonly 'onUpdate:modelValue': (v: any) => void
  readonly onInput: (e: any) => void
  readonly onChange: (e: any) => void
}
```

---

## Examples

### Custom input component

```vue
<!-- MyInput.vue -->
<script setup>
const modelValue = defineModel() // Vue 3.4+ sugar for v-model
</script>

<template>
  <input :value="modelValue" @input="modelValue = $event.target.value" />
</template>
```

```vue
<!-- usage -->
<MyInput v-bind="form.bind('email')" />
```

### Rendering errors

```vue
<p v-if="form.errors.email" class="text-red-500">
  {{ form.errors.email }}
</p>
```

- In `"change"` mode: errors appear as you type.
- In `"submit"` mode: errors appear only after `submit()` is attempted.

### Loading state

```vue
<button type="submit" :disabled="form.isInvalid.value">
  <span v-if="form.isSubmitting.value">Loading…</span>
  <span v-else>Submit</span>
</button>
```

---

## Testing

### Unit (no DOM)

Drive the composable in an `effectScope`, without mounting components.

```ts
import { effectScope, nextTick, unref } from 'vue'
import { describe, it, expect, vi } from 'vitest'
import * as v from 'valibot'
import { useForm } from '@lockvoid/vue-form'

const schema = v.pipe(v.object({ email: v.pipe(v.string(), v.email()) }))

describe('useForm', () => {
  it('validates and submits', async () => {
    const onSubmit = vi.fn()
    const scope = effectScope()
    const form = scope.run(() =>
      useForm({ schema, validationMode: 'change', onSubmit })
    )!

    // drive via binding
    const bind = form.bind('email')
    bind['onUpdate:modelValue']('john@example.com')
    await nextTick()

    expect(unref(form.isInvalid)).toBe(false)
    await form.submit()
    expect(onSubmit).toHaveBeenCalledWith({ email: 'john@example.com' })

    scope.stop()
  })
})
```

### Integration (mount)

```ts
import { mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import * as v from 'valibot'
import { useForm } from '@lockvoid/vue-form'

const Host = defineComponent({
  setup(_, { emit }) {
    const schema = v.pipe(v.object({ email: v.pipe(v.string(), v.email()) }))

    const form = useForm({
      schema,
      validationMode: 'change',
      onSubmit: (vals) => emit('success', vals),
    })

    return { form }
  },
  template: `
    <form @submit.prevent="form.submit">
      <input v-bind="form.bind('email')" data-testid="email" />

      <button data-testid="submit" :disabled="form.isInvalid.value">
        Submit
      </button>
    </form>
  `,
})

it('enables submit when valid', async () => {
  const wrapper = mount(Host)

  await wrapper.get('[data-testid="email"]').setValue('a@b.com')

  await nextTick()

  expect(wrapper.get('[data-testid="submit"]').attributes('disabled')).toBeUndefined()
})
```

## License

MIT © LockVoid Labs ~●~
