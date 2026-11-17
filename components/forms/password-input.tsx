'use client';

import { ArrowBigUpDash, Eye, EyeOff } from 'lucide-react';
import { type ComponentProps, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type PasswordInputProps = Omit<ComponentProps<'input'>, 'type'> & {
  /** A password being chosen: new-password autocomplete and the length rules for managers. */
  isNew?: boolean;
};

/**
 * A password field with "Show password" (S7.4). The toggle keeps its name and reports its state
 * with aria-pressed; it never submits, keeps the caret in the field for mouse and touch, and the
 * password is hidden again when the form is sent. Paste always works.
 */
export function PasswordInput({
  isNew = false,
  className,
  onKeyDown,
  onKeyUp,
  onBlur,
  onFocus,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return undefined;
    const hide = () => setVisible(false);
    form.addEventListener('submit', hide, true);
    return () => form.removeEventListener('submit', hide, true);
  }, []);

  const readCapsLock = (event: React.KeyboardEvent<HTMLInputElement>) =>
    setCapsLock(event.getModifierState('CapsLock'));

  return (
    <div>
      <div className="relative">
        <Input
          ref={inputRef}
          type={visible ? 'text' : 'password'}
          autoComplete={isNew ? 'new-password' : 'current-password'}
          autoCapitalize="none"
          spellCheck={false}
          maxLength={128}
          {...(isNew ? { passwordrules: 'minlength: 10; maxlength: 128;' } : {})}
          className={cn('pr-14', className)}
          onKeyDown={(event) => {
            readCapsLock(event);
            onKeyDown?.(event);
          }}
          onKeyUp={(event) => {
            readCapsLock(event);
            onKeyUp?.(event);
          }}
          onFocus={onFocus}
          onBlur={(event) => {
            setCapsLock(false);
            onBlur?.(event);
          }}
          {...props}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-touch"
          aria-pressed={visible}
          aria-controls={props.id}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => setVisible((shown) => !shown)}
          className="absolute inset-y-0 right-0 rounded-l-none rounded-r-xl text-neutral-3 hover:bg-neutral-7 focus-visible:-outline-offset-2"
        >
          <span className="relative size-5">
            <Eye
              className={cn(
                'absolute inset-0 size-5 transition-opacity duration-150',
                visible && 'opacity-0',
              )}
              aria-hidden
            />
            <EyeOff
              className={cn(
                'absolute inset-0 size-5 transition-opacity duration-150',
                !visible && 'opacity-0',
              )}
              aria-hidden
            />
          </span>
          <span className="sr-only">Show password</span>
        </Button>
      </div>
      {capsLock ? (
        <p className="mt-2 flex items-center gap-1.5 text-body-5 text-neutral-3">
          <ArrowBigUpDash className="size-4" aria-hidden />
          <span aria-hidden>Caps Lock is on</span>
        </p>
      ) : null}
    </div>
  );
}

declare module 'react' {
  interface InputHTMLAttributes<T> {
    /** Safari's password-rules hint for generated passwords. */
    passwordrules?: string;
  }
}
