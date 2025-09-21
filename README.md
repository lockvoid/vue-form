# @lockvoid/vue-form

Tiny, fast, **Vue 3** form composable with **stable bindings** and **Valibot** validation.

- Tiny: 1kb bundle (gzipped)
- Zero components, just a composable
- Works with any input (native or custom) via a simple binding shape
- Validation modes: `"change"`, `"blur"` and `"submit"`
- Easy to unit/integration test

## Installation

```bash
npm i @lockvoid/vue-form valibot
```

> `valibot` is a peer dependency.

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

  validationMode: 'change',

  async onSubmit({ email }) {
    await api.createUser({ email })
  },
})
</script>

<template>
  <form @submit.prevent="form.submit">
    <input v-bind="form.bind('email')" placeholder="Email" />

    <button type="submit" :disabled="form.isInvalid.value">
      Submit
    </button>

    <p v-if="form.errors.email">
      {{ form.errors.email }}
    </p>
  </form>
</template>

```

## Concepts

### Stable bindings

`form.bind('field')` returns the same object instance across renders with `modelValue`, event handlers (`onUpdate:modelValue`, `onInput`, `onChange`), and a name property. This avoids unnecessary prop/listener diffs in child inputs.

You can use it with:

-   native `<input>` (uses `onInput`)
-   custom components using `v-model` (uses `onUpdate:modelValue`)
-   or `onChange`-style components

### Validation modes

-   `"change"`: validates on every change and updates `errors` live.
-   `"submit"` (default): UI stays **neutral** until the first submit. After the first submit, errors are computed and validation switches to change mode.
-   `"blur"`: validates only when input loses focus (blur event). UI stays neutral until first blur.

## API

### `useForm(options)`

### Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `schema` | Valibot schema | *required* | Validation schema |
| `initialValues` | `Record<string, any>` | `{}` | Initial form values |
| `validationMode` | `'change' \| 'submit' \| 'blur'` | `'submit'` | When to validate |
| `onSubmit` | `(values) => void \| Promise<void>` | *required* | Submit handler |

### Returns

| Property | Type | Description |
|----------|------|-------------|
| `bind(name)` | `Binding` | Get stable binding for field |
| `submit()` | `Promise<void>` | Submit the form |
| `isInvalid` | `Ref<boolean>` | Form validation state |
| `isSubmitting` | `Ref<boolean>` | Submission loading state |
| `values` | `Record<string, any>` | Current form values |
| `errors` | `Record<string, string>` | Validation errors |

### Binding

Each `form.bind('field')` returns an object with:
- `modelValue` - current field value (for Vue components)
- `value` - current field value (for native HTML inputs)
- `onUpdate:modelValue` - v-model handler
- `onInput` / `onChange` - input event handlers
- `onBlur` - blur event handler (for blur validation mode)
- `name` - field name

## Examples

### Custom input component

```vue
<!-- MyInput.vue -->
<script setup>
const modelValue = defineModel()
</script>

<template>
  <input :value="modelValue" @input="modelValue = $event.target.value" />
</template>

```

```vue
<MyInput v-bind="form.bind('email')" />
```

### Rendering errors

```vue
<p v-if="form.errors.email" class="text-red-500">
  {{ form.errors.email }}
</p>

```

- In `"change"` mode: errors appear as you type.
- In `"submit"` mode: errors appear only after `submit()` is attempted, then validation switches to change mode.
- In `"blur"` mode: errors appear only after input loses focus.

### Loading state

```vue
<button type="submit" :disabled="form.isInvalid.value">
  <span v-if="form.isSubmitting.value">
    Loading…
  </span>

  <span v-else>
    Submit
  </span>
</button>

```

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
    // 1. Setup form with change validation
    const onSubmit = vi.fn()

    const scope = effectScope()

    const form = scope.run(() =>
      useForm({ schema, validationMode: 'change', onSubmit })
    )!

    // 2. Enter valid email
    const emailBinding = form.bind('email')

    emailBinding['onUpdate:modelValue']('john@example.com')

    await nextTick()

    // 3. Verify form becomes valid
    expect(unref(form.isInvalid)).toBe(false)

    // 4. Submit form
    await form.submit()

    // 5. Verify onSubmit was called with correct values
    expect(onSubmit).toHaveBeenCalledWith({ email: 'john@example.com' })

    // 6. Cleanup
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

    const form = useForm({ schema, validationMode: 'change', onSubmit: (values) => emit('success', values) })

    return { form };
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

  await wrapper.get('[data-testid="email"]').setValue('hey@example.com')

  await nextTick()

  expect(wrapper.get('[data-testid="submit"]').attributes('disabled')).toBeUndefined()
})
```

## License

MIT © LockVoid Labs ~●~
