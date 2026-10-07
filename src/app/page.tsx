export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
      <p className="text-muted text-xs tracking-[0.3em] uppercase">Est. Chane Barber</p>
      <h1 className="font-display text-5xl italic sm:text-7xl">Chane Barber</h1>
      <div className="bg-foreground h-px w-16" />
      <p className="text-muted max-w-sm font-light">
        Online booking is on its way. The booking engine is being built first.
      </p>
    </main>
  );
}
