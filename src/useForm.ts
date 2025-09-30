import * as v from "valibot";
import { reactive, ref, computed, onScopeDispose } from "vue";

type ValidationMode = "change" | "submit" | "blur";

type UseFormOptions = {
  schema: any;
  initialValues?: Record<string, any>;
  validationMode?: ValidationMode;
  onSubmit: (values: Record<string, any>) => unknown | Promise<unknown>;
};

type Binding = {
  modelValue: any;
  value: any;
  readonly name: string;
  readonly "onUpdate:modelValue": (v: any) => void;
  readonly onInput: (e: any) => void;
  readonly onChange: (e: any) => void;
  readonly onBlur: (e: any) => void;
  readonly _updateBinding?: () => void;
};

export function useForm(options: UseFormOptions) {
  const {
    schema,
    initialValues = {},
    validationMode = "submit",
    onSubmit,
  } = options;

  const values = reactive<Record<string, any>>({ ...initialValues });
  const isSubmitting = ref(false);
  const hasValidatedOnce = ref(validationMode === "change");
  const hasSubmittedOnce = ref(false);

  const parseResult = computed(() => {
    if ((validationMode === "submit" || validationMode === "blur") && !hasValidatedOnce.value) {
      return { success: true } as const;
    }
    return v.safeParse(schema, values);
  });

  const isInvalid = computed<boolean>(() => !parseResult.value.success);

  const errors = reactive<Record<string, string | null>>({});
  const fillErrorsFromIssues = (issues: any[] | undefined) => {
    for (const k of Object.keys(errors)) delete (errors as any)[k];
    if (!issues?.length) return;
    for (const issue of issues) {
      const path = (issue as any).path ?? [];
      const leaf = path.length ? path[path.length - 1] : undefined;
      const key =
        (leaf && (leaf.key ?? leaf)) ||
        (Array.isArray(path) && path[0]?.key) ||
        "form";
      if (typeof key === "string") {
        errors[key] = (issue as any).message || "Invalid";
      }
    }
  };

  // Initialize errors for change mode with initial values
  if (validationMode === "change") {
    const result = v.safeParse(schema, values);
    fillErrorsFromIssues((result as any).issues);
  }

  const recomputeErrors = () => {
    const result = v.safeParse(schema, values);
    fillErrorsFromIssues((result as any).issues);
  };

  const setValue = (name: string, value: any) => {
    (values as any)[name] = value;

    // Update binding for this field
    const binding = bindings.get(name);
    if (binding && binding._updateBinding) {
      binding._updateBinding();
    }

    if (validationMode === "change") {
      recomputeErrors();
    } else if (validationMode === "submit" && hasSubmittedOnce.value) {
      recomputeErrors();
    }
  };

  const getValue = (name: string) => (values as any)[name];

  const bindings = new Map<string, Binding>();
  const bind = (name: string): Binding => {
    const existing = bindings.get(name);
    if (existing) return existing;

    const onUpdateModelValue = (v: any) => setValue(name, v);
    const onInput = (e: any) => setValue(name, e?.target?.value ?? e);
    const onChange = (e: any) => setValue(name, e?.target?.value ?? e);
    const onBlur = (e: any) => {
      setValue(name, e?.target?.value ?? e);
      if (validationMode === "blur") {
        hasValidatedOnce.value = true;
        recomputeErrors();
      }
    };

    const binding = reactive({
      modelValue: getValue(name),
      value: getValue(name),
      name,
      "onUpdate:modelValue": onUpdateModelValue,
      onInput,
      onChange,
      onBlur,
      _updateBinding: () => {
        binding.modelValue = getValue(name);
        binding.value = getValue(name);
      },
    }) as Binding;

    bindings.set(name, binding);
    return binding;
  };

  onScopeDispose(() => bindings.clear());

  const submit = async () => {
    if (isSubmitting.value) return;

    hasValidatedOnce.value = true;
    hasSubmittedOnce.value = true;
    recomputeErrors();

    const result = v.safeParse(schema, values);
    if (!(result as any).success) return;

    isSubmitting.value = true;
    try {
      // Only submit values for fields that have been bound
      const boundValues: Record<string, any> = {};
      for (const fieldName of Array.from(bindings.keys())) {
        boundValues[fieldName] = values[fieldName];
      }
      await onSubmit(boundValues);
    } finally {
      isSubmitting.value = false;
    }
  };

  const reset = (nextValues: Record<string, any> = initialValues) => {
    for (const k of Object.keys(values)) delete (values as any)[k];
    Object.assign(values, nextValues);
    hasValidatedOnce.value = validationMode === "change";
    hasSubmittedOnce.value = false;
    for (const k of Object.keys(errors)) delete (errors as any)[k];

    // Re-initialize errors for change mode after reset
    if (validationMode === "change") {
      const result = v.safeParse(schema, values);
      fillErrorsFromIssues((result as any).issues);
    }
  };

  const setErrors = (next: Record<string, string | null>) => {
    for (const k of Object.keys(errors)) delete (errors as any)[k];
    Object.assign(errors, next);
  };

  return {
    bind,
    submit,
    isInvalid,
    isSubmitting,
    values,
    errors,
    setValue,
    getValue,
    reset,
    setErrors,
  };
}
