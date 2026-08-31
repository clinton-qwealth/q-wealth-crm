export function ConsentShell({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <p className="text-xs font-medium uppercase tracking-widest text-neutral-400">
          Q Wealth CRM
        </p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">{title}</h1>
        <div className="mt-4 flex flex-col gap-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
          {children}
        </div>
      </div>
    </main>
  )
}
