import { Hero, SpecialOffers, StarsChef, Delicious, Now } from '@/components/home'

import Image from 'next/image'

export default function Home() {
  return (
    <section>
      <Hero/>
      <SpecialOffers/>
      <StarsChef/>
      <Delicious/>
      <Now/>
    </section>
  )
}
