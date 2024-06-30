import BlogCard from "@/components/blog/BlogCard";
import Searchbar from "@/components/blog/Searchbar";
import React from "react";

const page = () => {
  return (
    <>
      <section className="flex justify-center items-center flex-col gap-3 py-20">
        <h1 className="component-title-text">Our Blogs</h1>
        <p className="component-sub-title-text">
          Best cooks and best delivery guys all at your service. Hot tasty food
          will reach you in 60 minutes.
        </p>
        <Searchbar />
      </section>
      <div className='flex items-start justify-start padding-x flex-col'>
        <h1 className="component-sub-title-text mb-5">Recent Blog Posts</h1>
        <BlogCard/>
      </div>
    </>
  );
};

export default page;
