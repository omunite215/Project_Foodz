import { useRouter } from "next/router";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/common";


interface ProductPageProps {
  title: string;
  imgSrc: string;
  price: number;
  description: string;
  flavours: string[];
}

const ProductPage = ({
  title,
  imgSrc,
  price,
  description,
  flavours,
}: ProductPageProps) => {
  return (
    <section>
      <div className="w-full flexStart flex-col">
        <Link
          href="/menu"
          className="w-full flexStart gap-3 px-5 py-[0.62rem] border border-neutralLineWhite rounded-lg"
        >
          <Image
            src="../../Icons/backArrow.svg"
            alt="back-arrow"
            width={0}
            height={0}
            className="w-6 h-6 object-contain"
          />
          <span className="">Go back</span>
        </Link>
      </div>
      <div className="w-full flexCenter pt-4 pb-12 gap-[5.38rem]">
        <Image
          src={imgSrc}
          alt="product-image"
          width={0}
          height={0}
          className="md:w-[26rem] sm:w-[24.9375rem] w-[20.0625rem] md:h-[26rem] sm:h-[24.9375rem] h-[20.0625rem]"
        />
        <div className=" flexStart flex-col md:gap-8 gap-6">
          <div>
            <h4>Best seller</h4>
            <div className="flexStart gap-6">
              <h1>{title}</h1>
              <div className="flexCenter gap-[0.62rem] px-2 py-1 border border-primaryGreen rounded-md">
                <Image
                  src="../../Home/specialoffers/fire.svg"
                  alt="fire"
                  width={24}
                  height={24}
                />
                <h3 className="special-offers-card-cooking-time">02:21:11</h3>
              </div>
            </div>
          </div>
          <div>
            <h1>{price}</h1>
          </div>
          <div className="flexBetween">
            <div className="flex justify-start items-center gap-3">
              <Image
                src="../../Home/specialoffers/stars.svg"
                height={24}
                width={136}
                alt="stars"
              />
              <p className="special-offers-card-rating">214 Reviews</p>
            </div>
            <p>View all</p>
          </div>
          <div className="flexstart flex-col gap-4">
            <article className="flexStart flex-col gap-2">
              <h5>Description</h5>
              <p>{description}</p>
            </article>
            <article className="flexStart flex-col gap-2">
              <h5>Adjust the flavor</h5>
              <ul className="grid grid-cols-3 list-disc">
                {flavours.map((flavor) => (
                  <li key={flavor}>{flavor}</li>
                ))}
              </ul>
            </article>
            <article className="flexStart flex-col gap-2">
              <h5>Note:</h5>
              <textarea
                name="note"
                className="form-input"
                cols={10}
                rows={5}
                placeholder="More spicy, more sauce, ..."
              ></textarea>
            </article>
          </div>
        </div>
        <Button/>
      </div>
    </section>
  );
};

export default ProductPage;