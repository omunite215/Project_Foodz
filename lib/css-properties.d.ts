/** A CSS custom property name, for example `--tab`. */
export type CssVariable = `--${string}`;

declare module 'react' {
  /** CSS custom properties in `style`, for example `style={{ '--tab': 1 }}`. */
  interface CSSProperties {
    [property: CssVariable]: string | number | undefined;
  }
}
