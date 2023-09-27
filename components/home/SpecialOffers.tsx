import { SpecialOffersContent } from "@/constants"
import { SpecialOffersCard } from "../common";

const SpecialOffers = () => {
  return (
    <section className="w-full flexCenter padding-x flex-col sm:gap-20 gap-[1.94rem]">
      <div className="w-full flexCenter flex-col text-center sm:gap-3 gap-2">
        <h1 className="component-title-text">
          Today <span className="component-title-highlight-text">Special</span> Offers
        </h1>
        <p className="component-sub-title-text">
          Best cooks and bext delivery guys all at your service. Hot tasty food
          will reach you in 60 minutes.
        </p>
      </div>
      <div className="flexBetween w-full md:flex-row flex-col md:justify-center sm:pb-20 pb-10 md:gap-[5.25rem] gap-3">
        {SpecialOffersContent.map((item, index) => (
          <div key={item.title}>
            <SpecialOffersCard
              title={item.title}
              imageSrc={item.imageSrc}
              price={item.price}
              show={index === 1 ? true : false}
              content={item.content}
              linkTitle="/checkout"
            />
          </div>
        ))}
      </div>
    </section>
  )
}

export default SpecialOffers