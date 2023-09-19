import React from "react";
import Link from "next/link";
import { menuContent } from "@/constants";

const Form = () => {
  return (
    <section className="flexStart flex-col gap-6 padding-x">
      <div>
        <h1 className="form-heading">What&apos;s your Taste?</h1>
        <p className="form-subHeading">
          Fill out the form and let us know your taste.
        </p>
      </div>
      <form action="" className="w-full flex flex-col flex-1 gap-4">
        <div className="form-label-box">
          <label
            htmlFor="meal"
            className="w-full flexBetween flex-1 form-label-text"
          >
            <p>Select your Meal</p>
            <Link
              href="/menu"
              className="text-primaryGreen hover:text-green-700"
            >
              View menu
            </Link>
          </label>
          <select name="taste" className="form-input">
            <option value="" disabled className="text-textNeutralBlack">
              What&#8217;s your Taste?
            </option>
            {menuContent.map((item) => (
              <option value={item.title} key={item.title}>
                {item.title}&nbsp;price: ${item.price}
              </option>
            ))}
          </select>
          <Link href="/menu" className=" font-poppins text-[0.875rem] opacity-80 font-normal leading-normal text-primaryGreen">Add 1 Taste + </Link>
        </div>
        <div className="flex flex-1 gap-3">
            <div className="form-label-box">
                <label htmlFor="name" className="form-label-text">Order name</label>
                <input type="text" name="name" className="form-input" placeholder="Your name"/>
            </div>
            <div className="form-label-box">
                <label htmlFor="name" className="form-label-text">Order name</label>
                <input type="number" name="name" className="form-input" placeholder="+(84) 123 465 798"/>
            </div>

        </div>
      </form>
    </section>
  );
};

export default Form;
