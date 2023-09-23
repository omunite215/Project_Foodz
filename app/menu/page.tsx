"use client";
import {useState} from "react";
import Image from "next/image";
import { SpecialOffersCard } from '@/components/common';
import { koreanMenu, VietnameseMenu, ThaiMenu } from '@/constants';



export default function Menu () {
  const [active, setActive] = useState("korean");
  return (
    <section>
      <div className='flexCenter flex-col sm:gap-3 gap-4 margin-y'>
        <h1 className='component-title-text'>Get <span className='component-title-highlight-text'>Special</span> Meal</h1>
        <p className='component-sub-title-text'>Best cooks and best delivery guys all at your service. Hot tasty food will reach you in 60 minutes.</p>
      </div>
      <div className='flexCenter w-full gap-9 flex-wrap'>
      <button
          className={`category-button ${
            active === "korean"
              ? "bg-primaryGreen text-white"
              : "bg-transparent text-textBlack"
          }`}
          onClick={() => setActive("korean")}
        >
          <Image
            src="../../Menu/Icon/food.svg"
            alt="food-icon"
            width={0}
            height={0}
            className="category-button-img"
          />
          <p className="category-button-text">Korean Food</p>
        </button>
        <button
          className={`category-button ${
            active === "vietnamese"
              ? "bg-primaryGreen text-white"
              : "bg-transparent text-textBlack"
          }`}
          onClick={() => setActive("vietnamese")}
        >
          <Image
            src="../../Menu/Icon/food.svg"
            alt="food-icon"
            width={0}
            height={0}
            className="category-button-img"
          />
          <p className="category-button-text">Vietnam Food</p>
        </button>
        <button
          className={`category-button ${
            active === "thai"
              ? "bg-primaryGreen text-white"
              : "bg-transparent text-textBlack"
          }`}
          onClick={() => setActive("thai")}
        >
          <Image
            src="../../Menu/Icon/food.svg"
            alt="food-icon"
            width={0}
            height={0}
            className="category-button-img"
          />
          <p className="category-button-text">Thai Food</p>
        </button>
      </div>
      <div className='grid sm:grid-cols-3 grid-cols-1 justify-center items-center sm:my-20 my-[3.75rem] sm:gap-y-20 gap-y-8 sm:px-32 px-10'>
        { active === "korean" &&
          koreanMenu.map((item) => (
            <SpecialOffersCard title={item.title} imageSrc={item.imgSrc} price={item.price} show={false} key={item.title} />
          ))
        }
        { active === "vietnamese" &&
          VietnameseMenu.map((item) => (
            <SpecialOffersCard title={item.title} imageSrc={item.imgSrc} price={item.price} show={false} key={item.title} />
          ))
        }
        { active === "thai" &&
          ThaiMenu.map((item) => (
            <SpecialOffersCard title={item.title} imageSrc={item.imgSrc} price={item.price} show={false} key={item.title} />
          ))
        }


      </div>
    </section>
  )
}