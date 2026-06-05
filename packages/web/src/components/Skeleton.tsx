import type { JSX } from "react";

const blockClasses = "animate-pulse rounded-md bg-zinc-200/80";

export function SkeletonCard(): JSX.Element {
  return (
    <article
      aria-hidden="true"
      className="h-[232px] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm"
      data-skeleton="card"
    >
      <div className="flex h-full">
        <div className="h-full w-1 shrink-0 bg-zinc-200" />
        <div className="flex min-w-0 flex-1 flex-col p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className={`${blockClasses} h-4 w-36`} />
              <div className={`${blockClasses} mt-3 h-3 w-full max-w-[13rem]`} />
              <div className={`${blockClasses} mt-2 h-3 w-28`} />
            </div>
            <div className={`${blockClasses} h-6 w-20 shrink-0`} />
          </div>

          <div className="mt-5 grid gap-3">
            <div className={`${blockClasses} h-8 w-full`} />
            <div className={`${blockClasses} h-8 w-full`} />
            <div className={`${blockClasses} h-8 w-full`} />
          </div>

          <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
            <div className={`${blockClasses} h-9 w-full`} />
            <div className={`${blockClasses} h-9 w-full`} />
          </div>
        </div>
      </div>
    </article>
  );
}

export function SkeletonList({ count = 3 }: { count?: number }): JSX.Element {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-skeleton="list">
      {Array.from({ length: count }, (_, index) => (
        <SkeletonCard key={index} />
      ))}
    </div>
  );
}

export function SkeletonDetail(): JSX.Element {
  return (
    <div aria-hidden="true" className="space-y-5" data-skeleton="detail">
      <div className="grid gap-3 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <section className="h-[118px] rounded-lg border border-zinc-200 bg-white p-4 shadow-sm" key={index}>
            <div className={`${blockClasses} h-3 w-24`} />
            <div className={`${blockClasses} mt-4 h-5 w-16`} />
            <div className={`${blockClasses} mt-4 h-3 w-full max-w-[14rem]`} />
          </section>
        ))}
      </div>

      <section className="h-[142px] rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-4 py-3">
          <div className={`${blockClasses} h-4 w-40`} />
        </div>
        <div className="grid grid-cols-2 gap-4 p-4 md:grid-cols-6">
          {Array.from({ length: 6 }, (_, index) => (
            <div className={index > 3 ? "hidden md:block" : undefined} key={index}>
              <div className={`${blockClasses} h-3 w-20`} />
              <div className={`${blockClasses} mt-3 h-4 w-24`} />
            </div>
          ))}
        </div>
      </section>

      <section className="h-[186px] rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-4 py-3">
          <div className={`${blockClasses} h-4 w-32`} />
        </div>
        <div className="divide-y divide-zinc-200 px-4">
          {Array.from({ length: 3 }, (_, index) => (
            <div
              className="grid h-[48px] grid-cols-[minmax(0,1fr)_5rem] items-center gap-3 lg:grid-cols-[minmax(0,1fr)_8rem_9rem_8rem]"
              key={index}
            >
              <div className={`${blockClasses} h-4 w-40`} />
              <div className={`${blockClasses} h-6 w-16`} />
              <div className={`${blockClasses} hidden h-4 w-20 lg:block`} />
              <div className={`${blockClasses} hidden h-8 w-24 lg:block`} />
            </div>
          ))}
        </div>
      </section>

      <section className="h-[148px] rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-4 py-3">
          <div className={`${blockClasses} h-4 w-32`} />
        </div>
        <div className="p-4">
          <div className={`${blockClasses} h-10 w-full`} />
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className={`${blockClasses} h-4 w-36`} />
            <div className={`${blockClasses} h-9 w-32`} />
          </div>
        </div>
      </section>
    </div>
  );
}
