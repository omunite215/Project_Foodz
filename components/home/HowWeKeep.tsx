import HowToCard from "../common/HowToCard";
import { howWeKeepContent } from "@/constants";

const HowWeKeep = () => {
  return (
    <section className="w-full flex flex-col justify-center items-center sm:gap-[6.69rem] gap-8 sm:py-14 py-10 sm:px-16 px-6">
      <h1 className=" font-alice sm:text-5xl text-[2rem] font-normal text-center leading-normal capitalize text-textBlack">
        How we keep your meal{" "}
        <span className=" text-primaryGreen">Delicious</span>
      </h1>
      <div className=" w-full flex md:flex-row flex-col justify-between items-center sm:gap-0 gap-8">
        {howWeKeepContent.map((card, index) => (
          <div key={card.title}>
            <HowToCard
              imageSrc={card.imageSrc}
              title={card.title}
              description={card.description}
              bg={index === 1 ? true : false}
            />
          </div>
        ))}
      </div>
    </section>
  );
};

export default HowWeKeep;
