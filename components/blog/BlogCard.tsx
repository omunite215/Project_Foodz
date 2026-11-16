import Image from 'next/image';
import Badge from './Badge';

const BlogCard = () => {
  return (
    <article className="flex max-w-[636px] flex-col items-start">
      <Image
        src="/Blog/blog1.png"
        width={636}
        height={318}
        className="h-auto w-full rounded-2xl object-contain"
        alt=""
      />
      <p className="mt-5 mb-3 text-caption font-medium text-muted-foreground">
        <time dateTime="2022-06-20">Jun 20, 2022</time>
      </p>
      <h3 className="my-3 text-title-2 font-medium text-neutral-3">
        Healthy Food Choices for Your Family
      </h3>
      <p className="mb-8 text-body-5 text-muted-foreground md:w-2/3">
        How can you ensure that your child is well nourished? Here are some tips to keep in mind
        when planning and preparing meals for your family.
      </p>
      <div className="flex flex-wrap gap-4">
        <Badge type="Food" />
        <Badge type="Healthy" />
        <Badge type="Family" />
      </div>
    </article>
  );
};

export default BlogCard;
