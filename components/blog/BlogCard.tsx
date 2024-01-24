import Image from "next/image";
import React from "react";
import Badge from "./Badge";

const BlogCard = () => {
  return (
    <div className="flexStart flex-col font-poppins">
      <Image
        src="/blog/blog1.png"
        width={636}
        height={318}
        className=" object-contain"
        priority
        alt="blog-img"
      />
      <p className="text-xs text-textNeutralBlack font-medium mt-5 mb-3">&#x2022; Jun 20, 2022</p>
      <h1 className=" text-2xl font-medium text-paraTextColor my-3">Healthy Food Choices for Your Family</h1>
      <p className=" text-sm text-textNeutralBlack w-2/3 mb-8">
        How can you ensure that your child is well nourished? Here are some tips
        to keep in mind when planning and preparing meals for your family.
      </p>
      <div className="flexStart gap-4">
        <Badge type="Food"/>
        <Badge type="Healthy" />
        <Badge type="Family" />
      </div>
    </div>
  );
};

export default BlogCard;
