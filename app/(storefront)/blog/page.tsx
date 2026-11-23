import type { Metadata } from 'next';
import BlogCard from '@/components/blog/BlogCard';
import { PageContainer } from '@/components/layout/page-container';

export const metadata: Metadata = { title: 'Blog' };

export default function BlogPage() {
  return (
    <PageContainer className="pt-10 pb-15 md:pt-20 md:pb-20">
      <section className="mx-auto flex max-w-[770px] flex-col items-center gap-3 text-center">
        <h1 className="font-heading text-h4 leading-tight text-neutral-2 md:text-h2">Our blog</h1>
        <p className="text-body-4 text-muted-foreground md:text-body-1 xl:text-neutral-3">
          Best cooks and best delivery people at your service. Hot food at your door in about 45
          minutes.
        </p>
      </section>
      <div className="mt-10 md:mt-15">
        <h2 className="mb-5 text-body-2 text-neutral-3 md:text-body-1">Recent blog posts</h2>
        <BlogCard />
      </div>
    </PageContainer>
  );
}
