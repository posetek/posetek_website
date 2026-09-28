import React from 'react';
import {Composition} from 'remotion';
import {Film} from './Film';
import {FilmV3} from './FilmV3';
import {InvestorFilm} from './InvestorFilm';
import {ProductFilm,PRODUCT_DURATION} from './ProductFilm';
import {InvestorExactFilm,EXACT_DURATION} from './InvestorExactFilm';
import {InvestorExactFilmV2,EXACT_V2_DURATION} from './InvestorExactFilmV2';
import {InvestorExactFilmV3,EXACT_V3_DURATION} from './InvestorExactFilmV3';
import {InvestorExactFilmV4,EXACT_V4_DURATION} from './InvestorExactFilmV4';
import {WeakFootInvestorV1,WEAK_FOOT_V1_DURATION} from './WeakFootInvestorV1';
export const Root:React.FC=()=> <>
 <Composition id="PoseTekDraftBV2" component={Film} durationInFrames={1650} fps={30} width={1080} height={1920}/>
 <Composition id="PoseTekCoachesV3" component={FilmV3} durationInFrames={1560} fps={30} width={1080} height={1920}/>
 <Composition id="PoseTekInvestorV1" component={InvestorFilm} durationInFrames={2700} fps={30} width={1920} height={1080}/>
 <Composition id="PoseTekProductV1" component={ProductFilm} durationInFrames={PRODUCT_DURATION} fps={30} width={1920} height={1080}/>
 <Composition id="PoseTekInvestorExactV1" component={InvestorExactFilm} durationInFrames={EXACT_DURATION} fps={30} width={1920} height={1080}/>
 <Composition id="PoseTekInvestorExactV2" component={InvestorExactFilmV2} durationInFrames={EXACT_V2_DURATION} fps={30} width={1920} height={1080}/>
 <Composition id="PoseTekInvestorExactV3" component={InvestorExactFilmV3} durationInFrames={EXACT_V3_DURATION} fps={30} width={1920} height={1080}/>
 <Composition id="PoseTekInvestorExactV4" component={InvestorExactFilmV4} durationInFrames={EXACT_V4_DURATION} fps={30} width={1920} height={1080}/>
 <Composition id="PoseTekWeakFootInvestorV1" component={WeakFootInvestorV1} durationInFrames={WEAK_FOOT_V1_DURATION} fps={30} width={1080} height={1920}/>
</>;
