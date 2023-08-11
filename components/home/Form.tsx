"use client";
import Image from "next/image";
import Link from "next/link";
import { OrderNowButton } from "../common";
import { menuContent } from "@/constants";

const Form = () => {
  return (
    <div className=" flex flex-col gap-[6.5rem] flex-1 w-full justify-center md:items-start items-center py-14 sm:px-16 px-6">
      <div className=" w-full flex flex-col justify-center items-center gap-3 text-center">
        <h1 className=" font-alice text-5xl text-textBlack font-normal leading-normal capitalize">
          Get the best Taste <span className=" text-primaryGreen">Now!</span>
        </h1>
        <h2 className=" font-poppins text-textNeutralBlack">
          Best cooks and best delivery guys all at your service. Hot tasty food
          will reach you in 60 minutes.
        </h2>
      </div>
      <div className="w-full flex md:flex-row flex-col justify-between items-start">
        <div className=" flex flex-col justify-center items-start gap-6 font-poppins leading-normal font-normal">
          <div className=" flex flex-col gap-1">
            <h1 className=" text-[#141416] text-2xl">
              What&#8217;s your Taste?
            </h1>
            <h3 className=" text-paraTextColor text-base">
              Fill out the form and let us know your taste.
            </h3>
          </div>
          <form action="" className=" flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <div className="flex sm:w-full w-3/4 justify-between items-start">
                <label htmlFor="meal">Select your Meal</label>
                <Link href="/menu" className=" text-primaryGreen">
                  View menu
                </Link>
              </div>
              <select name="meal" id="">
                <option
                  value="What&#8217;s your Taste?"
                  disabled
                  selected
                  hidden
                  className=" disabled:text-textNeutralBlack"
                >
                  What&#8217;s your Taste?
                </option>
                {menuContent.map((item) => (
                  <option value={item.title} key={item.title}>
                    {item.title}&nbsp;price: ${item.price}
                  </option>
                ))}
              </select>
              <p className=" font-poppins text-sm text-primaryGreen">
                Add 1 Taste +
              </p>
            </div>
            <div className="flex sm:flex-row flex-col justify-between items-start gap-3">
              <div className="flex w-full flex-col gap-2">
                <label htmlFor="name">Order Name</label>
                <input type="text" name="name" id="" placeholder="Your name" />
              </div>
              <div className="flex w-full flex-col gap-2">
                <label htmlFor="phone">Phone Number</label>
                <input
                  type="tel"
                  name="phone"
                  id=""
                  placeholder="(+84) 123 465 798"
                />
              </div>
            </div>

            <div className="w-full flex flex-col gap-2">
              <label htmlFor="address">Your Address</label>
              <input
                type="text"
                name="address"
                id=""
                placeholder="17 abc street"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="payment">Payment Method</label>
              <select name="payment" id="">
                <option value="I&#8217;ll Pay Cash" disabled selected hidden>
                  I&#8217;ll Pay Cash
                </option>
                <option value="cash">Cash</option>
                <option value="card">Credit/Debit Card</option>
                <option value="netbanking">Net Banking</option>
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="note">Note for us</label>
              <textarea
                name="note"
                id=""
                cols={30}
                rows={5}
                placeholder="More spicy, more sauce.."
                className=" placeholder:text-textNeutralBlack resize-none pt-[0.625rem] pl-[1.25rem] rounded-[0.75rem] border-[1px] border-solid border-textNeutralBlack"
              ></textarea>
            </div>
            <h3 className=" text-textNeutralBlack font-poppins text-base flex justify-start items-center gap-1 ">
              You will pay{" "}
              <span className=" font-alice text-primaryGreen text-2xl">
                $0.00
              </span>
            </h3>
            <OrderNowButton />
          </form>
        </div>
        <Image
          src="../../scooter.svg"
          width={540}
          height={430}
          alt="scooter"
          className=" sm:block hidden"
        />
      </div>
    </div>
  );
};

export default Form;
