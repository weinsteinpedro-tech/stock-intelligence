import { SearchBar } from "./components/SearchBar";
import { WatchlistSection } from "./components/WatchlistSection";

export default function Home() {
  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="mb-4 text-xl font-bold">Market Overview</h1>
        <SearchBar />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">My Watchlist</h2>
        <WatchlistSection />
      </section>
    </div>
  );
}
