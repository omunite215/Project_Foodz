import { countryCodes, menuContent } from "@/constants";
import Link from "next/link";
import React from "react";
import { Button } from ".";

const Form = () => {
	return (
		<section className="flexStart flex-col gap-6 padding-x">
			<div>
				<h1 className="form-heading">What&apos;s your Taste?</h1>
				<p className="form-subHeading">
					Fill out the form and let us know your taste.
				</p>
			</div>
			<form action="" className="w-full flex flex-col flex-1 sm:gap-4 gap-6">
				<div className="form-box">
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
					<Link
						href="/menu"
						className=" font-poppins text-[0.875rem] opacity-80 font-normal leading-normal text-primaryGreen"
					>
						Add 1 Taste +{" "}
					</Link>
				</div>
				<div className="flex flex-1 gap-3">
					<div className="form-box">
						<label htmlFor="name" className="form-label-text">
							Order name
						</label>
						<input
							type="text"
							name="name"
							className="form-input"
							placeholder="Your name"
						/>
					</div>
					<div className="form-box">
						<label htmlFor="name" className="form-label-text">
							Phone number
						</label>
						<div className="flexCenter gap-1.5">
							<select name="phone" defaultValue="+84" className="form-input max-w-[90px]">
								<option value="+84">
									VN
								</option>
								{countryCodes.map((item) => (
									<option value={item.name} key={item.name}>
										{item.name}&nbsp;{item.code}
									</option>
								))}
							</select>
							<input
								type="tel"
								name="name"
								className="form-input"
								placeholder="+(84) 123 465 798"
								pattern="[0-9]{3}-[0-9]{3}-[0-9]{3}"
							/>
						</div>
					</div>
				</div>
				<div className="form-box">
					<label htmlFor="address" className="form-label-text">
						Your Address
					</label>
					<input
						type="text"
						name="address"
						placeholder="17 Acb Street"
						className="form-input"
					/>
				</div>
				<div className="form-box">
					<label htmlFor="payment">Payment Method</label>
					<select
						name="payment"
						defaultValue="cash"
						className="w-1/2 form-input"
					>
						<option value="cash">I&apos;ll pay cash</option>
						<option value="card">I&apos;ll pay card</option>
						<option value="net-banking">I&apos;ll pay net-banking</option>
						<option value="upi">I&apos;ll pay UPI</option>
					</select>
				</div>
				<div className="form-box">
					<label htmlFor="note">Note for us</label>
					<textarea
						name="note"
						className="form-input"
						cols={10}
						rows={5}
						placeholder="More spicy, more sauce, ..."
					/>
				</div>
				<p className=" font-poppins text-textNeutralBlack text-opacity-80 text-base">
					You will pay&nbsp;
					<span className=" font-alice text-primaryGreen text-2xl">$0.00</span>
				</p>
				<div className="mt-8">
					<Button />
				</div>
			</form>
		</section>
	);
};

export default Form;
