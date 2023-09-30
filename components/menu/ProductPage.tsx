import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/common";

interface ProductPageProps {
  title?: string;
  imgSrc?: string;
  price?: number;
  description?: string;
}

const flavors =  ["Sugar", "Gochujang", "Rice win vinegar", "Strawberry jam", "Soy sauce", "Garlic", "Ginger", "Butter"];

const ProductPage = ({
  title,
  imgSrc,
  price,
  description,
}: ProductPageProps) => {
  return (
    <section>
      <div className=" padding-x flexStart flex-col">
        <Link
          href="/menu"
          className="flexStart gap-3 px-5 py-[0.62rem] border border-neutralLineWhite rounded-lg"
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
      <div className="w-full flexCenter padding-x pt-4 pb-12 gap-[5.38rem]">
        <Image
          src={imgSrc ? imgSrc : '../../noimage.png'}
          alt="product-image"
          width={0}
          height={0}
          className="md:w-[26rem] sm:w-[24.9375rem] w-[20.0625rem] md:h-[26rem] sm:h-[24.9375rem] h-[20.0625rem]"
        />
        <div className=" flexStart flex-col md:gap-8 gap-6 max-w-[41.25rem]">
          <div>
            <h4 className=" font-poppins text-base text-paraTextColor font-normal">Best seller</h4>
            <div className="flex justify-start items-center gap-6">
              <h1 className=" font-alice text-5xl font-normal capitalize text-textBlack">{title}</h1>
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
            <h1 className=" font-alice text-[2.5rem] -tracking-[0.0125rem] text-primaryGreen">${price}</h1>
          </div>
          <div className="w-full flexBetween">
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
          <div className="flexstart flex-col gap-10">
            <article className="flexStart flex-col gap-2">
              <h5>Description</h5>
              <p>{description}</p>
            </article>
            <article className="flexStart flex-col gap-2 ml-5">
              <h5 className=" font-poppins text-base text-paraTextColor">Adjust the flavor</h5>
              <ul className="grid grid-cols-3 list-disc gap-x-6 text-textNeutralBlack text-xs leading-3">
                {flavors.map((flavor) => (
                  <li key={flavor} className=" py-1 px-3">{flavor}</li>
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
          <Link href="/checkout">
          <Button />
        </Link>
        </div>
      </div>
      
    </section>
  );
};

export default ProductPage;
