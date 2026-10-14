import { StackProvider } from "../lib/stack-client";
export const instant = false;
export default function HandlerLayout({ children }: { children: React.ReactNode }) { return <StackProvider>{children}</StackProvider>; }
