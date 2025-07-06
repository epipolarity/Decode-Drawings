import { arrayToTextLines, map } from "./utils.js";

// version 2 of the drawing decoder class
// very uniquely calculates x and y coordinates from ball radii and centroids
// i tried taking shortcuts rather than doing maths and ended up in a strange place
// i was desperately fumbling around trying to improve on v1 and did not 
//         document the 'logic' behind this very well, and now it's anyone's guess
// luckily it doesn't work very well so it's not worth understanding!
export default class DrawingDecoder {

    constructor() {
        this.collector = [];
    }


    decode(ctx, balls) {

        const { ballGap, range } = this.#getRange(balls);
        const offset = this.#getOffset(balls, ballGap);

        const x = map(offset, -10, 10, 200, 500);

        const yCm = Math.sqrt(Math.pow(range, 2) - Math.pow(offset, 2)) - 18;

        const y = map(yCm, 0, 20, 200, 500);

        if (this.lastPosition && (x != this.lastPosition.x || y != this.lastPosition.y)) {
            ctx.beginPath();
            ctx.moveTo(this.lastPosition.x, this.lastPosition.y);
            ctx.lineTo(x, y);
            ctx.stroke();
            
            this.collector.push(Math.round(x) + ' ' + Math.round(y));
        }

        this.lastPosition = { x, y };

        return { x, y };
    }


    toString() {
        return arrayToTextLines(this.collector);
    }


    #getRange(balls) {

        const { blue, green } = balls;

        // perceived distance = pixels between green and blue centroids
        // 316px at start
        // 164px at bottom

        const ballGap = map(green.centroid.x - blue.centroid.x, 164, 316, 0.233, 0.47);

        // convert to cm range
        const range = 2.8832 * Math.pow(ballGap, -1.583);

        return { ballGap, range };

    }


    #getOffset(balls, ballGap) {

        const { blue, green } = balls;

        // radius 106px at start
        // radius 56px at bottom

        const excelPerceivedSizeBlue = map(blue.radius, 56, 106, 0.156, 0.319);
        const excelPerceivedSizeGreen = map(green.radius, 56, 106, 0.156, 0.319);

        const angleOfB = Math.asin(excelPerceivedSizeBlue);
        const angleOfG = Math.asin(excelPerceivedSizeGreen);
        const diffAngle = (180 / Math.PI) * (angleOfG - angleOfB);

        const weirdCalc = diffAngle / Math.pow(ballGap, 3.6);

        return 11 * Math.sin(weirdCalc / 101);

    }

}