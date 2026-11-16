const Searchbar = () => {
  return (
    <search className="my-5 flex w-full max-w-md items-stretch">
      <label htmlFor="blog-search" className="sr-only">
        Search the blog
      </label>
      <input
        id="blog-search"
        type="search"
        className="h-11 min-w-0 flex-auto rounded-l-lg border border-input bg-white px-3 text-body-4 text-neutral-2"
        placeholder="Search"
      />
      <button
        className="h-11 rounded-r-lg bg-brand-strong px-6 text-button-2 font-medium text-white uppercase hover:bg-brand-strong/90"
        type="button"
      >
        Search
      </button>
    </search>
  );
};

export default Searchbar;
