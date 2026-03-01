import { text, password, confirm, select, isCancel, cancel } from '@clack/prompts';

function handleCancel(value: unknown): asserts value is string | boolean {
  if (isCancel(value)) {
    cancel('Operation cancelled.');
    process.exit(0);
  }
}

export async function promptVideoSource(): Promise<string> {
  const value = await text({
    message: 'YouTube URL or local file path',
    placeholder: 'https://youtube.com/watch?v=...',
    validate(input) {
      if (!input || input.trim().length === 0) {
        return 'A video source is required.';
      }
    },
  });

  handleCancel(value);
  return value.trim();
}

export async function promptContext(): Promise<string | undefined> {
  const value = await text({
    message: 'Optional context about the video',
    placeholder: 'e.g. CS lecture, product demo (press Enter to skip)',
  });

  handleCancel(value);
  const result = value.trim();
  return result.length > 0 ? result : undefined;
}

export async function promptApiKey(): Promise<string> {
  const value = await password({
    message: 'Gemini API key',
    validate(input) {
      if (!input || input.trim().length === 0) {
        return 'An API key is required.';
      }
    },
  });

  handleCancel(value);
  return value.trim();
}

export async function promptSaveKey(): Promise<boolean> {
  const value = await confirm({
    message: 'Save API key to config for future use?',
    initialValue: false,
  });

  handleCancel(value);
  return value;
}

export type ConfirmationChoice = 'start' | 'edit-video' | 'edit-context' | 'cancel';

export async function promptConfirmation(): Promise<ConfirmationChoice> {
  const value = await select({
    message: 'Ready to process?',
    options: [
      { value: 'start' as const, label: 'Start processing' },
      { value: 'edit-video' as const, label: 'Edit video source' },
      { value: 'edit-context' as const, label: 'Edit context' },
      { value: 'cancel' as const, label: 'Cancel' },
    ],
  });
  handleCancel(value);
  return value as ConfirmationChoice;
}
