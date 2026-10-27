"use client";

import type { ComponentPropsWithoutRef } from "react";
import {
  MarkdownTextPrimitive,
  memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from "@assistant-ui/react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

const components = memoizeMarkdownComponents({
  a: (props: ComponentPropsWithoutRef<"a">) => (
    <a {...props} target="_blank" rel="noopener noreferrer" />
  ),
  code: function Code({
    className,
    children,
    ...props
  }: ComponentPropsWithoutRef<"code">) {
    const isCodeBlock = useIsMarkdownCodeBlock();
    return (
      <code
        {...props}
        className={className}
        data-inline={isCodeBlock ? undefined : ""}
      >
        {children}
      </code>
    );
  },
});

export function MarkdownText() {
  return (
    <MarkdownTextPrimitive
      className="aui-md"
      components={components}
      remarkPlugins={[remarkGfm, remarkBreaks]}
    />
  );
}
